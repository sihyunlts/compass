import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

const findWhere = (selector) => {
  let where;
  selector.walkPseudos((pseudo) => {
    if (!where && pseudo.value === ':where') where = pseudo;
  });
  return where;
};

function expandWhere(selector) {
  const where = findWhere(selector);
  if (!where) return [selector];

  // A list inside another functional pseudo needs different Boolean semantics.
  // Reject it rather than silently changing the rule's meaning.
  if (where.nodes.length > 1 && where.parent !== selector) {
    throw new Error(`Cannot expand a nested :where() list: ${selector}`);
  }

  return where.nodes.flatMap((option) => {
    const copy = selector.clone();
    findWhere(copy).replaceWith(...option.nodes.map((node) => node.clone()));
    return expandWhere(copy);
  });
}

export function addLegacySelectorFallbacks(css) {
  const stylesheet = postcss.parse(css);

  const retainFallback = (node) => {
    if (node.type === 'rule') {
      if (!node.selector.includes(':where(')) {
        node.remove();
        return;
      }
      const selectors = selectorParser().astSync(node.selector, { lossless: false });
      node.selector = selectors.nodes.flatMap(expandWhere).join(',');
    } else if (node.type === 'atrule' && node.nodes) {
      // Retain media/support conditions, but omit fonts and empty containers.
      [...node.nodes].forEach(retainFallback);
      if (!node.nodes.length) node.remove();
    } else {
      node.remove();
    }
  };
  [...stylesheet.nodes].forEach(retainFallback);
  if (!stylesheet.nodes.length) return css;

  const fallback = postcss.atRule({ name: 'supports', params: 'not selector(:where(*))' });
  fallback.append(stylesheet.nodes);
  // Modern engines keep the original CSS. Only older engines get the expanded
  // selectors, whose additional specificity is unavoidable.
  return `${css}\n${fallback}`;
}
