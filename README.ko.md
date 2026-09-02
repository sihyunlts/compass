<div align="center">
  <p><a href="README.md">English</a></p>
  <img width="3840" height="1440" alt="Compass" src="https://github.com/user-attachments/assets/ba80995b-65fc-4e0d-94b1-c9448fe9bb1f" />
  <h1>Compass</h1>
  <p>Compass는 랙 기반 워크플로우로 독특한 라이트 이펙트를 빠르게 실험해볼 수 있는 런치패드 라이트쇼 도구입니다.</p>
  <p>
    <a href="https://github.com/sihyunlts/compass/releases/latest">
      <img src="https://img.shields.io/github/v/release/sihyunlts/compass?label=Download" alt="Download Latest Release" />
    </a>
    <a href="LICENSE">
      <img src="https://img.shields.io/badge/License-0BSD-black" alt="0BSD License" />
    </a>
  </p>
</div>

## 꼭 읽어주세요

**Compass의 코드는 AI를 활용해 작성되었습니다.** 저는 HTML/CSS와 같은 마크업, 스타일시트만 조금 읽을 줄 알고 프로그래밍은 배워본 경험이 없습니다.

아시다시피, 아직은 AI가 맥락을 완벽하게 이해하지 못하기 때문에 문제 해결을 요청하면 설계 자체에서 원인을 찾는 대신 우회해서 해결하는 경향이 있었습니다. 물론 문서화도 해놓고 Fixture도 만들어서 최소한의 설계 원칙을 벗어나지 않도록 노력은 했습니다만, 저 역시 체계적인 무언가를 만드는 것에 익숙하지 않아서 지침이 상당히 허술한 상태고, 결과적으로는 앱 자체도 생각처럼 작동하지 않는 경우가 잦습니다. **따라서 이 앱을 사용하신다면, 만들어 둔 랙이 바로 다음 버전에서도 제대로 작동하지 않는 상황을 각오해주셔야 합니다.**

주변에서 사용해보고 싶다는 요청이 있었기에 오픈소스로 공개하긴 했지만 이 프로젝트의 목적은 처음부터 이 아이디어가 실현 가능한지에 대한 궁금증 해소였고, 지금도 개인적인 사용을 목적으로 개선하고 있습니다. 즉 이 프로젝트는 제가 기능을 마음대로 없애거나 변경할 수도 있고, 아니면 갑자기 유지보수를 중단해버릴 수도 있습니다.

저는 반드시 Ableton Live에서 Compass의 기능을 사용해야만 하는 상황이 아니라면, [Anth의 Amethyst](https://amethyst.anthonyhfm.dev/)에 탑재된 크리스탈 컴포지션 기능을 사용해보시는 것을 추천드립니다. Compass의 아이디어를 기반으로 하지만 노드 형태를 갖추고 있고, 이 프로젝트와 달리 실제 프로그래머가 개발하고 있기 때문에 훨씬 신뢰성이 높을 거라고 생각합니다.

마지막으로, Compass는 [0BSD 라이선스](LICENSE)를 사용하기 때문에 직접 새로운 디바이스나 기능을 추가해서 재배포하시거나, 다른 프로그램에 Compass의 기능을 마음껏 구현하셔도 좋습니다.

## 이게 왜 필요한가요?

기존에는 런치패드 라이트쇼를 제작하려면 패턴을 프레임 단위로 그린 다음 색을 입혀야 했습니다. 아주 직관적이고 이해하기 쉬운 방법이지만, 패턴을 미세하게 조정하기 어려워 완벽한 효과를 찾기 위해서는 패턴을 그리는 과정부터 수없이 반복해야 했고, 효과를 20° 정도만 회전시키거나 크기를 조절하는 것이 불가능해 아이디어를 그대로 구현하기에는 한계가 있었습니다.

반면 Compass는 선을 기반으로 계산한 뒤 마지막에 노트로 변환하기 때문에 회전, 이동, 대칭과 같은 효과를 순차적으로 적용할 수 있습니다. 예를 들어 패스 디바이스로 도형을 그리고 회전과 크기를 모듈레이터로 제어하면 아래와 같은 효과를 간단하게 만들 수 있습니다.

https://github.com/user-attachments/assets/1d18c875-45b7-4ec0-a8bf-5234ce4bdcd8

> [!NOTE]
> 다만 Compass가 기존의 제작 방식을 대체할 수는 없습니다. 완전히 다른 방식을 사용한다는 것은 기존에 없던 효과를 만들 수 있다는 의미이기도 하지만, 특정 효과에서는 더 비효율적이거나 원하는 모양을 얻기 어려운 경우도 있기 때문입니다.

## 시작하기

> [!NOTE]
> Compass는 MIDI 노트를 생성하고, Max for Live 브릿지를 통해 Ableton Live로 전송합니다. 즉, 기본적으로 Live의 플러그인처럼 동작합니다.
> 따라서 전송 기능을 사용하려면 Max for Live를 지원하는 Live 10 Suite(Max 8) 이상 버전이 필요합니다. 만약 Suite 미만 버전이나 다른 앱에서 사용해야 하는 경우 Compass 웹에서 효과를 MIDI 파일로 다운로드할 수 있습니다.

1. 각 운영 체제에 맞는 설치 프로그램을 실행해 Compass를 설치한 뒤 앱을 실행합니다.
2. Ableton Live를 열고 `CompassBridge-vX.X.X.amxd`를 미디 트랙에 추가합니다(Compass 앱과 동일한 버전의 브릿지 사용을 권장합니다).
3. Ableton Live에서 BPM을 변경하면 Compass 앱에 자동으로 동기화됩니다.
4. 원하는 디바이스를 왼쪽 브라우저에서 끌어당겨 랙을 구성하고, 오른쪽 미리보기에서 효과를 확인합니다.
5. Ableton Live에서 교체하고 싶은 미디 클립을 선택하거나, 클립이 없다면 트랙 위에서 원하는 위치를 선택한 뒤 `Send` 버튼을 누릅니다.

> [!IMPORTANT]
> macOS 앱은 개발자 서명이 없기 때문에 설치 후 터미널에서 다음 명령어를 실행해야 정상적으로 실행됩니다.
```sh
xattr -dr com.apple.quarantine /Applications/Compass.app
```

## 개발 환경

요구 사항:

- Node.js `24.13.1`
- npm `11.5.1`

설치:

```sh
npm ci
```

Electron 앱 실행:

```sh
npm start
```

웹에서 실행:

```sh
npm run web:dev
```