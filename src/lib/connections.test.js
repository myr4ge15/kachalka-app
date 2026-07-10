import { describe, it, expect } from 'vitest'
import {
  connectionDirection,
  deriveConnections,
  acceptedOtherIds,
  hasConnection,
  mergeConnectionOp,
} from './connections.js'

const ME = 'me'

describe('connectionDirection', () => {
  it('accepted → accepted независимо от инициатора', () => {
    expect(connectionDirection({ status: 'accepted', requested_by: ME }, ME)).toBe('accepted')
    expect(connectionDirection({ status: 'accepted', requested_by: 'x' }, ME)).toBe('accepted')
  })
  it('pending: я инициатор → outgoing, чужой инициатор → incoming', () => {
    expect(connectionDirection({ status: 'pending', requested_by: ME }, ME)).toBe('outgoing')
    expect(connectionDirection({ status: 'pending', requested_by: 'x' }, ME)).toBe('incoming')
  })
  it('пустая строка → null', () => {
    expect(connectionDirection(null, ME)).toBe(null)
    expect(connectionDirection({}, ME)).toBe(null)
  })
})

describe('deriveConnections', () => {
  it('раскладывает по корзинам и проставляет direction', () => {
    const rows = [
      { other_id: 'a', status: 'accepted', requested_by: ME },
      { other_id: 'b', status: 'pending', requested_by: 'b' }, // incoming
      { other_id: 'c', status: 'pending', requested_by: ME },  // outgoing
      { other_id: 'bad' }, // без status → отброшено
    ]
    const { accepted, incoming, outgoing } = deriveConnections(rows, ME)
    expect(accepted.map((r) => r.other_id)).toEqual(['a'])
    expect(incoming.map((r) => r.other_id)).toEqual(['b'])
    expect(outgoing.map((r) => r.other_id)).toEqual(['c'])
    expect(accepted[0].direction).toBe('accepted')
    expect(incoming[0].direction).toBe('incoming')
  })
  it('пустой/undefined вход → пустые корзины', () => {
    expect(deriveConnections(undefined, ME)).toEqual({ accepted: [], incoming: [], outgoing: [] })
  })
})

describe('acceptedOtherIds / hasConnection', () => {
  const rows = [
    { other_id: 'a', status: 'accepted' },
    { other_id: 'b', status: 'pending' },
  ]
  it('acceptedOtherIds берёт только принятые', () => {
    expect(acceptedOtherIds(rows)).toEqual(['a'])
    expect(acceptedOtherIds(null)).toEqual([])
  })
  it('hasConnection ловит любую связь (в т.ч. pending)', () => {
    expect(hasConnection(rows, 'a')).toBe(true)
    expect(hasConnection(rows, 'b')).toBe(true)
    expect(hasConnection(rows, 'z')).toBe(false)
  })
})

describe('mergeConnectionOp', () => {
  it('request на пустую очередь → [request]', () => {
    expect(mergeConnectionOp([], 'request')).toEqual([{ op: 'request' }])
  })
  it('request дедуплицируется', () => {
    const existing = [{ op: 'request' }]
    expect(mergeConnectionOp(existing, 'request')).toBe(existing)
  })
  it('accept на пустую → [accept], повтор дедуп', () => {
    expect(mergeConnectionOp([], 'accept')).toEqual([{ op: 'accept' }])
    const existing = [{ op: 'accept' }]
    expect(mergeConnectionOp(existing, 'accept')).toBe(existing)
  })
  it('remove затирает любую очередь → [remove]', () => {
    expect(mergeConnectionOp([{ op: 'request' }], 'remove')).toEqual([{ op: 'remove' }])
    expect(mergeConnectionOp([{ op: 'accept' }], 'remove')).toEqual([{ op: 'remove' }])
    expect(mergeConnectionOp([], 'remove')).toEqual([{ op: 'remove' }])
  })
  it('request поверх стоявшего remove → заменяет на request', () => {
    expect(mergeConnectionOp([{ op: 'remove' }], 'request')).toEqual([{ op: 'request' }])
  })
})
