/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * Werewolf Game Engine
 * Pure game logic — tidak bergantung pada WhatsApp/skyline-JXRA.
 *
 * Supported roles:
 * - werewolf
 * - seer
 * - doctor
 * - hunter
 * - villager
 *
 * Fase:
 * - lobby
 * - night
 * - day
 * - voting
 * - hunter
 * - ended
 */

import { randomInt } from 'node:crypto'

const MIN_PLAYERS = 5
const MAX_PLAYERS = 15

const PHASES = Object.freeze({
  LOBBY: 'lobby',
  NIGHT: 'night',
  DAY: 'day',
  VOTING: 'voting',
  HUNTER: 'hunter',
  ENDED: 'ended'
})

const ROLES = Object.freeze({
  WEREWOLF: 'werewolf',
  SEER: 'seer',
  DOCTOR: 'doctor',
  HUNTER: 'hunter',
  VILLAGER: 'villager'
})

const ROLE_INFO = Object.freeze({
  werewolf: {
    name: 'Werewolf',
    team: 'wolf',
    emoji: '🐺'
  },
  seer: {
    name: 'Seer',
    team: 'village',
    emoji: '🔮'
  },
  doctor: {
    name: 'Doctor',
    team: 'village',
    emoji: '💉'
  },
  hunter: {
    name: 'Hunter',
    team: 'village',
    emoji: '🏹'
  },
  villager: {
    name: 'Villager',
    team: 'village',
    emoji: '👨‍🌾'
  }
})

function assert(condition, message) {
  if (!condition) {
    const error = new Error(message)
    error.code = 'WW_ERROR'
    throw error
  }
}

function shuffle(input) {
  const arr = [...input]

  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    const temp = arr[i]
    arr[i] = arr[j]
    arr[j] = temp
  }

  return arr
}

function now() {
  return Date.now()
}

function uniqueId(prefix = 'ww') {
  return `${prefix}_${now()}_${randomInt(100000, 999999)}`
}

function normalizePlayerId(id) {
  return String(id || '').trim()
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createPlayer(id, name = null) {
  const playerId = normalizePlayerId(id)

  return {
    id: playerId,
    name: String(name || playerId),
    role: null,
    alive: true,
    joinedAt: now(),
    death: null,
    meta: {}
  }
}

function getRoleSet(playerCount) {
  assert(
    Number.isInteger(playerCount) &&
      playerCount >= MIN_PLAYERS &&
      playerCount <= MAX_PLAYERS,
    `Jumlah pemain harus antara ${MIN_PLAYERS}-${MAX_PLAYERS}.`
  )

  if (playerCount === 5) {
    return [
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.SEER,
      ROLES.DOCTOR,
      ROLES.VILLAGER
    ]
  }

  if (playerCount === 6) {
    return [
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.SEER,
      ROLES.DOCTOR,
      ROLES.HUNTER,
      ROLES.VILLAGER
    ]
  }

  if (playerCount === 7) {
    return [
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.SEER,
      ROLES.DOCTOR,
      ROLES.HUNTER,
      ROLES.VILLAGER
    ]
  }

  if (playerCount === 8) {
    return [
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.SEER,
      ROLES.DOCTOR,
      ROLES.HUNTER,
      ROLES.VILLAGER,
      ROLES.VILLAGER
    ]
  }

  // Mode 9+ sementara menggunakan pola scaling sederhana.
  const roles = [
    ROLES.WEREWOLF,
    ROLES.WEREWOLF,
    ROLES.WEREWOLF,
    ROLES.SEER,
    ROLES.DOCTOR,
    ROLES.HUNTER
  ]

  while (roles.length < playerCount) {
    roles.push(ROLES.VILLAGER)
  }

  return roles
}

function createEvent(type, data = {}) {
  return {
    id: uniqueId('event'),
    type,
    at: now(),
    ...data
  }
}

export class WerewolfGame {
  constructor(options = {}) {
    this.id = options.id || uniqueId('game')
    this.chatId = options.chatId || null
    this.hostId = options.hostId || null
    this.maxPlayers = options.maxPlayers || MAX_PLAYERS

    this.phase = PHASES.LOBBY
    this.day = 0
    this.createdAt = now()
    this.startedAt = null
    this.endedAt = null

    this.players = new Map()
    this.nightActions = new Map()
    this.votes = new Map()
    this.pendingHunter = null
    this.lastNightResult = null
    this.winner = null
    this.reason = null
    this.events = []
  }

  emit(type, data = {}) {
    const event = createEvent(type, {
      gameId: this.id,
      day: this.day,
      phase: this.phase,
      ...data
    })

    this.events.push(event)

    // Supaya memory game tidak membengkak selamanya.
    if (this.events.length > 300) {
      this.events.splice(0, this.events.length - 300)
    }

    return event
  }

  get playerCount() {
    return this.players.size
  }

  get alivePlayers() {
    return [...this.players.values()].filter(player => player.alive)
  }

  get deadPlayers() {
    return [...this.players.values()].filter(player => !player.alive)
  }

  getPlayer(id) {
    return this.players.get(normalizePlayerId(id)) || null
  }

  hasPlayer(id) {
    return this.players.has(normalizePlayerId(id))
  }

  addPlayer(id, name = null) {
    assert(this.phase === PHASES.LOBBY, 'Game sudah dimulai.')
    assert(this.playerCount < this.maxPlayers, 'Lobby sudah penuh.')

    const playerId = normalizePlayerId(id)

    assert(playerId, 'ID pemain tidak valid.')
    assert(!this.players.has(playerId), 'Pemain sudah join.')

    const player = createPlayer(playerId, name)
    this.players.set(playerId, player)

    this.emit('player_join', {
      playerId,
      playerName: player.name
    })

    return clone(player)
  }

  removePlayer(id) {
    assert(this.phase === PHASES.LOBBY, 'Pemain tidak bisa keluar setelah game dimulai.')

    const playerId = normalizePlayerId(id)
    assert(this.players.has(playerId), 'Pemain tidak ditemukan.')

    this.players.delete(playerId)

    this.emit('player_leave', {
      playerId
    })

    return true
  }

  canStart() {
    return (
      this.phase === PHASES.LOBBY &&
      this.playerCount >= MIN_PLAYERS &&
      this.playerCount <= this.maxPlayers
    )
  }

  start() {
    assert(this.phase === PHASES.LOBBY, 'Game sudah dimulai atau sudah selesai.')
    assert(
      this.playerCount >= MIN_PLAYERS,
      `Minimal ${MIN_PLAYERS} pemain untuk memulai game.`
    )

    const players = [...this.players.values()]
    const roles = shuffle(getRoleSet(players.length))

    players.forEach((player, index) => {
      player.role = roles[index]
      player.alive = true
      player.death = null
    })

    this.phase = PHASES.NIGHT
    this.day = 1
    this.startedAt = now()

    this.emit('game_start', {
      playerCount: players.length,
      roleCount: roles.length
    })

    this.emit('night_start', {
      day: this.day
    })

    return this.getState()
  }

  isAlive(id) {
    return Boolean(this.getPlayer(id)?.alive)
  }

  requireAlive(id) {
    const player = this.getPlayer(id)

    assert(player, 'Pemain tidak ditemukan.')
    assert(player.alive, 'Pemain tersebut sudah mati.')

    return player
  }

  requirePhase(...allowedPhases) {
    assert(
      allowedPhases.includes(this.phase),
      `Aksi tidak bisa dilakukan pada fase ${this.phase}.`
    )
  }

  setNightAction(actorId, action, targetId = null) {
    this.requirePhase(PHASES.NIGHT)

    const actor = this.requireAlive(actorId)
    const target = targetId ? this.getPlayer(targetId) : null

    assert(
      [ROLES.WEREWOLF, ROLES.SEER, ROLES.DOCTOR].includes(actor.role),
      'Role lo tidak punya skill malam.'
    )

    assert(target, 'Target tidak ditemukan.')
    assert(target.alive, 'Target sudah mati.')

    if (actor.role === ROLES.WEREWOLF) {
      assert(target.id !== actor.id, 'Werewolf tidak bisa menarget diri sendiri.')
      assert(target.role !== ROLES.WEREWOLF, 'Werewolf tidak bisa menyerang sesama werewolf.')
    }

    if (actor.role === ROLES.SEER) {
      assert(target.id !== actor.id, 'Seer tidak bisa memeriksa diri sendiri.')
    }

    this.nightActions.set(actor.id, {
      actorId: actor.id,
      role: actor.role,
      action,
      targetId: target.id,
      submittedAt: now()
    })

    this.emit('night_action_submitted', {
      actorId: actor.id,
      action
    })

    return {
      ok: true,
      action,
      targetId: target.id
    }
  }

  getNightStatus() {
    const alive = this.alivePlayers

    const wolves = alive.filter(player => player.role === ROLES.WEREWOLF)
    const required = alive.filter(player =>
      [ROLES.WEREWOLF, ROLES.SEER, ROLES.DOCTOR].includes(player.role)
    )

    return {
      required: required.length,
      submitted: required.filter(player => this.nightActions.has(player.id)).length,
      complete: required.every(player => this.nightActions.has(player.id)),
      wolves: {
        required: wolves.length,
        submitted: wolves.filter(player => this.nightActions.has(player.id)).length,
        complete: wolves.every(player => this.nightActions.has(player.id))
      }
    }
  }

  resolveNight(force = false) {
    this.requirePhase(PHASES.NIGHT)

    const status = this.getNightStatus()
    assert(force || status.complete, 'Belum semua role malam mengirim aksi.')

    const alive = this.alivePlayers
    const actions = [...this.nightActions.values()]

    const wolfActions = actions.filter(action => action.role === ROLES.WEREWOLF)
    const seerAction = actions.find(action => action.role === ROLES.SEER)
    const doctorAction = actions.find(action => action.role === ROLES.DOCTOR)

    let victimId = null

    if (wolfActions.length > 0) {
      const attackCounts = new Map()

      for (const action of wolfActions) {
        const count = attackCounts.get(action.targetId) || 0
        attackCounts.set(action.targetId, count + 1)
      }

      const highest = Math.max(...attackCounts.values())
      const candidates = [...attackCounts.entries()]
        .filter(([, count]) => count === highest)
        .map(([targetId]) => targetId)

      victimId = candidates[randomInt(candidates.length)]
    }

    const savedId = doctorAction?.targetId || null
    const killedByWolf = victimId && victimId !== savedId ? victimId : null

    if (killedByWolf) {
      this.killPlayer(killedByWolf, 'wolf_attack')
    }

    const seerResult = seerAction
      ? {
          actorId: seerAction.actorId,
          targetId: seerAction.targetId,
          result: this.getPlayer(seerAction.targetId)?.role === ROLES.WEREWOLF
            ? 'werewolf'
            : 'not_werewolf'
        }
      : null

    this.lastNightResult = {
      day: this.day,
      victimId: killedByWolf,
      savedId: victimId && victimId === savedId ? savedId : null,
      seerResult
    }

    this.nightActions.clear()

    this.emit('night_resolved', {
      victimId: killedByWolf,
      saved: Boolean(victimId && victimId === savedId)
    })

    if (killedByWolf && this.getPlayer(killedByWolf)?.role === ROLES.HUNTER) {
      this.phase = PHASES.HUNTER
      this.pendingHunter = killedByWolf

      this.emit('hunter_turn', {
        playerId: killedByWolf,
        cause: 'wolf_attack'
      })

      return this.getState()
    }

    this.finishNight()

    return this.getState()
  }

  finishNight() {
    if (this.phase === PHASES.ENDED) return

    const winner = this.checkWinner()

    if (winner) {
      this.endGame(winner.team, winner.reason)
      return
    }

    this.phase = PHASES.DAY

    this.emit('day_start', {
      day: this.day,
      victimId: this.lastNightResult?.victimId || null
    })
  }

  submitHunterShot(hunterId, targetId) {
    this.requirePhase(PHASES.HUNTER)

    const hunter = this.getPlayer(hunterId)
    const target = this.getPlayer(targetId)

    assert(hunter, 'Hunter tidak ditemukan.')
    assert(hunter.id === this.pendingHunter, 'Bukan giliran hunter ini.')
    assert(target, 'Target tidak ditemukan.')
    assert(target.alive, 'Target sudah mati.')
    assert(target.id !== hunter.id, 'Hunter tidak bisa menembak diri sendiri.')

    this.killPlayer(target.id, 'hunter_shot')

    this.emit('hunter_shot', {
      hunterId: hunter.id,
      targetId: target.id
    })

    this.pendingHunter = null

    const winner = this.checkWinner()

    if (winner) {
      this.endGame(winner.team, winner.reason)
    } else {
      this.finishNight()
    }

    return this.getState()
  }

  skipHunterShot(hunterId) {
    this.requirePhase(PHASES.HUNTER)

    assert(
      this.pendingHunter === normalizePlayerId(hunterId),
      'Bukan giliran hunter ini.'
    )

    this.emit('hunter_skipped', {
      hunterId
    })

    this.pendingHunter = null
    this.finishNight()

    return this.getState()
  }

  beginVoting() {
    this.requirePhase(PHASES.DAY)

    this.phase = PHASES.VOTING
    this.votes.clear()

    this.emit('voting_start', {
      day: this.day
    })

    return this.getState()
  }

  submitVote(voterId, targetId) {
    this.requirePhase(PHASES.VOTING)

    const voter = this.requireAlive(voterId)
    const target = this.getPlayer(targetId)

    assert(target, 'Target vote tidak ditemukan.')
    assert(target.alive, 'Target sudah mati.')
    assert(voter.id !== target.id, 'Tidak bisa vote diri sendiri.')

    this.votes.set(voter.id, target.id)

    this.emit('vote_submitted', {
      voterId: voter.id
    })

    return {
      ok: true,
      submitted: this.votes.size,
      required: this.alivePlayers.length,
      complete: this.votes.size >= this.alivePlayers.length
    }
  }

  getVoteStatus() {
    return {
      submitted: this.votes.size,
      required: this.alivePlayers.length,
      complete: this.votes.size >= this.alivePlayers.length
    }
  }

  resolveVoting(force = false) {
    this.requirePhase(PHASES.VOTING)

    const status = this.getVoteStatus()
    assert(force || status.complete, 'Belum semua pemain melakukan voting.')

    const counts = new Map()

    for (const targetId of this.votes.values()) {
      counts.set(targetId, (counts.get(targetId) || 0) + 1)
    }

    let executedId = null

    if (counts.size > 0) {
      const highest = Math.max(...counts.values())
      const candidates = [...counts.entries()]
        .filter(([, count]) => count === highest)
        .map(([targetId]) => targetId)

      // Tie = tidak ada yang dieksekusi.
      if (candidates.length === 1) {
        executedId = candidates[0]
        this.killPlayer(executedId, 'vote')
      }
    }

    const executed = executedId ? this.getPlayer(executedId) : null

    this.emit('voting_resolved', {
      executedId,
      tied: !executedId && counts.size > 0
    })

    this.votes.clear()

    if (executed?.role === ROLES.HUNTER) {
      this.phase = PHASES.HUNTER
      this.pendingHunter = executed.id

      this.emit('hunter_turn', {
        playerId: executed.id,
        cause: 'vote'
      })

      return this.getState()
    }

    const winner = this.checkWinner()

    if (winner) {
      this.endGame(winner.team, winner.reason)
      return this.getState()
    }

    this.day += 1
    this.phase = PHASES.NIGHT

    this.emit('night_start', {
      day: this.day
    })

    return this.getState()
  }

  killPlayer(id, cause) {
    const player = this.getPlayer(id)
    if (!player || !player.alive) return false

    player.alive = false
    player.death = {
      cause,
      day: this.day,
      at: now()
    }

    this.emit('player_death', {
      playerId: player.id,
      cause
    })

    return true
  }

  checkWinner() {
    const alive = this.alivePlayers

    const wolves = alive.filter(player => player.role === ROLES.WEREWOLF)
    const villagers = alive.filter(player => player.role !== ROLES.WEREWOLF)

    if (wolves.length === 0) {
      return {
        team: 'village',
        reason: 'Semua werewolf sudah mati.'
      }
    }

    if (wolves.length >= villagers.length) {
      return {
        team: 'werewolf',
        reason: 'Jumlah werewolf sudah menyamai atau melebihi warga.'
      }
    }

    return null
  }

  endGame(team, reason) {
    this.phase = PHASES.ENDED
    this.winner = team
    this.reason = reason
    this.endedAt = now()

    this.emit('game_end', {
      winner: team,
      reason
    })

    return this.getState()
  }

  getRoleOf(id) {
    const player = this.getPlayer(id)
    return player?.role || null
  }

  getPrivateState(id) {
    const player = this.getPlayer(id)

    if (!player) return null

    const base = {
      gameId: this.id,
      phase: this.phase,
      day: this.day,
      player: clone(player),
      winner: this.winner,
      reason: this.reason
    }

    if (player.role === ROLES.WEREWOLF) {
      base.wolfMates = this.alivePlayers
        .filter(other =>
          other.role === ROLES.WEREWOLF &&
          other.id !== player.id
        )
        .map(other => ({
          id: other.id,
          name: other.name,
          alive: other.alive
        }))
    }

    if (player.role === ROLES.SEER && this.lastNightResult?.seerResult) {
      if (this.lastNightResult.seerResult.actorId === player.id) {
        const target = this.getPlayer(this.lastNightResult.seerResult.targetId)

        base.lastInspection = {
          targetId: target?.id,
          targetName: target?.name,
          result: this.lastNightResult.seerResult.result
        }
      }
    }

    return base
  }

  getPublicState() {
    return {
      gameId: this.id,
      chatId: this.chatId,
      phase: this.phase,
      day: this.day,
      playerCount: this.playerCount,
      aliveCount: this.alivePlayers.length,
      players: [...this.players.values()].map(player => ({
        id: player.id,
        name: player.name,
        alive: player.alive,
        death: player.death
          ? {
              cause: player.death.cause,
              day: player.death.day
            }
          : null
      })),
      lastNight: this.lastNightResult
        ? {
            day: this.lastNightResult.day,
            victimId: this.lastNightResult.victimId,
            saved: Boolean(this.lastNightResult.savedId)
          }
        : null,
      winner: this.winner,
      reason: this.reason
    }
  }

  getState() {
    return {
      public: this.getPublicState(),
      events: clone(this.events.slice(-20))
    }
  }

  serialize() {
    return {
      id: this.id,
      chatId: this.chatId,
      hostId: this.hostId,
      maxPlayers: this.maxPlayers,
      phase: this.phase,
      day: this.day,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      players: [...this.players.values()],
      nightActions: [...this.nightActions.values()],
      votes: [...this.votes.entries()],
      pendingHunter: this.pendingHunter,
      lastNightResult: this.lastNightResult,
      winner: this.winner,
      reason: this.reason,
      events: this.events
    }
  }
}

export function createWerewolfGame(options = {}) {
  return new WerewolfGame(options)
}

export function getWerewolfRoleInfo(role) {
  return ROLE_INFO[role] ? clone(ROLE_INFO[role]) : null
}

export function getWerewolfRoleSet(playerCount) {
  return getRoleSet(playerCount)
}

export const WerewolfPhases = PHASES
export const WerewolfRoles = ROLES

export default {
  WerewolfGame,
  createWerewolfGame,
  getWerewolfRoleInfo,
  getWerewolfRoleSet,
  WerewolfPhases,
  WerewolfRoles
}
