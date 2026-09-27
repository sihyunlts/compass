import assert from 'node:assert/strict';

/**
 * Pack a MIDI Effect's JSON and dependencies without reading another AMXD.
 * @param {{name: string, type: string, bytes: Buffer, flag?: number}[]} resources
 * @returns {Buffer}
 */
export function buildMidiEffectDevice(resources) {
  // Reproduce the released device's ampf/ptch + mx@c layout. Container lengths
  // are little-endian; collective resource sizes and offsets are big-endian.
  // Fixed metadata makes identical inputs produce identical bytes on every OS.
  const uint32 = (value) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(value);
    return bytes;
  };
  const chunk = (tag, bytes) => Buffer.concat([Buffer.from(tag), uint32(bytes.length + 8), bytes]);
  let resourceOffset = 16;
  const entries = resources.map((resource) => {
    const name = Buffer.from(`${resource.name}\0`);
    const paddedName = Buffer.alloc(Math.ceil(name.length / 4) * 4);
    name.copy(paddedName);
    const entry = chunk('dire', Buffer.concat([
      chunk('type', Buffer.from(resource.type)), chunk('fnam', paddedName),
      chunk('sz32', uint32(resource.bytes.length)), chunk('of32', uint32(resourceOffset)),
      chunk('vers', uint32(0)), chunk('flag', uint32(resource.flag ?? 0)), chunk('mdat', uint32(0)),
    ]));
    resourceOffset += resource.bytes.length;
    return entry;
  });
  const collective = Buffer.concat([
    Buffer.from('mx@c'), uint32(16), uint32(0), uint32(resourceOffset),
    ...resources.map((resource) => resource.bytes), chunk('dlst', Buffer.concat(entries)),
  ]);
  // MIDI Effect (mmmm), metadata flags 7, matching the released bridge header.
  const header = Buffer.alloc(32);
  Buffer.from('616d7066040000006d6d6d6d6d657461040000000700000070746368', 'hex').copy(header);
  header.writeUInt32LE(collective.length, 28);
  const device = Buffer.concat([header, collective]);

  // Decode the serialized directory independently before replacing the artifact.
  // This checks the sizes/offsets used by Max, not just concatenation order.
  assert.equal(device.readUInt32LE(28), device.length - 32);
  const directoryOffset = 32 + device.readUInt32BE(44);
  assert.equal(device.toString('ascii', directoryOffset, directoryOffset + 4), 'dlst');
  assert.equal(directoryOffset + device.readUInt32BE(directoryOffset + 4), device.length);
  let cursor = directoryOffset + 8;
  let payloadOffset = 48;
  for (const resource of resources) {
    assert.equal(device.toString('ascii', cursor, cursor + 4), 'dire');
    const entryEnd = cursor + device.readUInt32BE(cursor + 4);
    assert.ok(entryEnd <= device.length);
    const fields = new Map();
    for (let field = cursor + 8; field < entryEnd;) {
      const length = device.readUInt32BE(field + 4);
      assert.ok(length >= 8 && field + length <= entryEnd, 'Invalid directory field boundary');
      fields.set(device.toString('ascii', field, field + 4), device.subarray(field + 8, field + length));
      field += length;
    }
    assert.equal(fields.get('fnam').toString('utf8').split('\0')[0], resource.name);
    assert.equal(fields.get('type').toString('ascii'), resource.type);
    assert.equal(fields.get('flag').readUInt32BE(), resource.flag ?? 0);
    assert.equal(fields.get('mdat').readUInt32BE(), 0);
    const offset = 32 + fields.get('of32').readUInt32BE();
    const size = fields.get('sz32').readUInt32BE();
    assert.equal(offset, payloadOffset);
    assert.equal(size, resource.bytes.length);
    assert.ok(offset + size <= directoryOffset);
    assert.ok(device.subarray(offset, offset + size).equals(resource.bytes), `Embedded ${resource.name} differs from source`);
    if (resource.type === 'JSON') {
      assert.equal(device[offset + size - 1], 0);
      assert.deepEqual(
        JSON.parse(device.toString('utf8', offset, offset + size - 1)),
        JSON.parse(resource.bytes.subarray(0, -1).toString('utf8')),
      );
    }
    payloadOffset += size;
    cursor = entryEnd;
  }
  assert.equal(payloadOffset, directoryOffset);
  assert.equal(cursor, device.length);
  return device;
}
