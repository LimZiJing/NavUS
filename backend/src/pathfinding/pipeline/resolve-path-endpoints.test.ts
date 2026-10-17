import { describe, expect, it } from 'vitest'
import type { Building } from '@navus/shared/venue/buildings'
import type { TransitIndex } from '@navus/shared/transit/index'
import { buildBuildingIndex } from '../endpoints.ts'
import { resolvePathEndpoints } from './resolve-path-endpoints.ts'

const com3: Building = {
  id: 'com3',
  name: 'COM3',
  aliases: [],
  elementId: 'way/1',
  location: { x: 103.7752, y: 1.2951 },
  locationKind: 'centroid',
  roomCodePrefixes: [],
  sourceRefs: [],
}
const stop = { id: 'COM3', longName: 'COM3', shortName: 'COM3', latitude: 1.2944, longitude: 103.7752, services: [] }
const transit = { stops: [stop], stopById: new Map([[stop.id, stop]]) } as unknown as TransitIndex

describe('resolvePathEndpoints with buildings', () => {
  it('keeps a building and the bus stop of the same name as separate locations', () => {
    const resolved = resolvePathEndpoints(
      { kind: 'building', id: 'com3' },
      { kind: 'stop', id: 'COM3' },
      {},
      transit,
      buildBuildingIndex([com3]),
    )

    expect(resolved?.origin).toMatchObject({
      key: 'building:com3',
      coordinate: { longitude: 103.7752, latitude: 1.2951 },
    })
    expect(resolved?.destination).toMatchObject({
      key: 'stop:COM3',
      coordinate: { longitude: 103.7752, latitude: 1.2944 },
    })
    expect(resolved?.all.map((location) => location.key)).toEqual(['building:com3', 'stop:COM3'])
  })

  it('returns null when the building is not in the catalogue', () => {
    expect(
      resolvePathEndpoints({ kind: 'building', id: 'gone' }, { kind: 'stop', id: 'COM3' }, {}, transit, buildBuildingIndex([com3])),
    ).toBeNull()
  })
})
