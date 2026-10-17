/**
 * © skyline-JXRA
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * vps.js — Monitor resource VPS dan proses teratas
 */

import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function fmtUptime(seconds) {
  const total = Math.floor(Number(seconds) || 0)

  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60

  const parts = []

  if (days) parts.push(`${days} hari`)
  if (hours) parts.push(`${hours} jam`)
  if (minutes) parts.push(`${minutes} mnt`)

  parts.push(`${secs} dtk`)

  return parts.join(' ')
}

function fmtBytes(bytes) {
  const value = Number(bytes) || 0

  if (value >= 1024 ** 3) {
    return `${(value / 1024 ** 3).toFixed(1)} GB`
  }

  if (value >= 1024 ** 2) {
    return `${(value / 1024 ** 2).toFixed(1)} MB`
  }

  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }

  return `${value} B`
}

function bar(percent, length = 10) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0))
  const filled = Math.round((value / 100) * length)

  return '▰'.repeat(filled) + '▱'.repeat(length - filled)
}

function statusIcon(percent, warning = 60, danger = 85) {
  if (percent >= danger) return '🔴'
  if (percent >= warning) return '🟡'
  return '🟢'
}

function parseNumber(value) {
  const number = Number.parseFloat(String(value).replace(',', '.'))
  return Number.isFinite(number) ? number : 0
}

async function getCpuUsage() {
  const readCpu = () => {
    const cpus = os.cpus()

    let idle = 0
    let total = 0

    for (const cpu of cpus) {
      const times = cpu.times

      idle += times.idle
      total += times.user + times.nice + times.sys + times.idle + times.irq
    }

    return { idle, total }
  }

  const first = readCpu()

  await sleep(700)

  const second = readCpu()

  const idleDelta = second.idle - first.idle
  const totalDelta = second.total - first.total

  if (totalDelta <= 0) return 0

  return Math.max(
    0,
    Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100)
  )
}

async function getMemoryInfo() {
  const total = os.totalmem()
  const free = os.freemem()
  const used = total - free

  let swapTotal = 0
  let swapFree = 0

  try {
    const { stdout } = await execFileAsync('free', ['-b'])
    const swapLine = stdout
      .split('\n')
      .find((line) => line.trim().startsWith('Swap:'))

    if (swapLine) {
      const parts = swapLine.trim().split(/\s+/)

      swapTotal = Number(parts[1]) || 0
      swapFree = Number(parts[3]) || 0
    }
  } catch {
  }

  return {
    total,
    used,
    percent: total > 0 ? (used / total) * 100 : 0,
    swapTotal,
    swapUsed: Math.max(0, swapTotal - swapFree),
    swapPercent:
      swapTotal > 0
        ? ((swapTotal - swapFree) / swapTotal) * 100
        : 0
  }
}

async function getDiskInfo() {
  try {
    const { stdout } = await execFileAsync('df', [
      '-B1',
      '-P',
      '/'
    ])

    const lines = stdout.trim().split('\n')
    const line = lines.at(-1)

    if (!line) {
      throw new Error('Output disk kosong')
    }

    const parts = line.trim().split(/\s+/)

    const total = Number(parts[1]) || 0
    const used = Number(parts[2]) || 0
    const percent = parseNumber(parts[4])

    return {
      total,
      used,
      percent
    }
  } catch {
    return {
      total: 0,
      used: 0,
      percent: 0
    }
  }
}

async function getSshStatus() {
  const services = ['ssh', 'sshd']

  for (const service of services) {
    try {
      const { stdout } = await execFileAsync('systemctl', [
        'is-active',
        service
      ])

      const status = stdout.trim()

      if (status === 'active') {
        return {
          icon: '🟢',
          text: `${service} — active`
        }
      }
    } catch {
    }
  }

  return {
    icon: '🔴',
    text: 'SSH tidak aktif / tidak terdeteksi'
  }
}

async function getProcessInfo() {
  try {
    const { stdout } = await execFileAsync('ps', [
      '-eo',
      'pid=,pcpu=,pmem=,etime=,comm=,args=',
      '--sort=-pcpu'
    ])

    const lines = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    const processes = []

    for (const line of lines) {
      const parts = line.split(/\s+/)

      if (parts.length < 5) continue

      const pid = Number(parts[0])
      const cpu = parseNumber(parts[1])
      const memory = parseNumber(parts[2])
      const elapsed = parts[3]
      const commandName = parts[4]
      const command = parts.slice(5).join(' ')

      if (!Number.isFinite(pid)) continue

      const fullCommand = `${commandName} ${command}`.toLowerCase()

      const isMonitoringCommand =
        commandName === 'ps' ||
        fullCommand.startsWith('ps ') ||
        fullCommand.includes('/ps ')

      if (isMonitoringCommand) continue

      if (pid === process.pid) continue

      processes.push({
        pid,
        cpu,
        memory,
        elapsed,
        name: commandName || command || '-'
      })
    }

    const taskCount = lines.length

    return {
      taskCount,
      topCpu: processes
        .slice()
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 5),
      topMemory: processes
        .slice()
        .sort((a, b) => b.memory - a.memory)
        .slice(0, 5)
    }
  } catch {
    return {
      taskCount: 0,
      topCpu: [],
      topMemory: []
    }
  }
}

function formatProcessList(processes, type) {
  if (!processes.length) {
    return '└ Tidak ada data proses'
  }

  return processes
    .map((process, index) => {
      const value =
        type === 'cpu'
          ? `${process.cpu.toFixed(1)}% CPU`
          : `${process.memory.toFixed(1)}% RAM`

      return `${index + 1}. \`${process.name.slice(0, 35)}\` ` +
        `PID ${process.pid} — ${value} — ${process.elapsed}`
    })
    .join('\n')
}

function getWarnings({ cpuUsage, load, cores, memory, disk, processInfo }) {
  const warnings = []

  const averageLoad = load[0] || 0
  const loadLimit = Math.max(cores * 1.5, 2)

  if (cpuUsage >= 85) {
    warnings.push(`CPU tinggi (${cpuUsage.toFixed(1)}%)`)
  }

  if (averageLoad >= loadLimit) {
    warnings.push(
      `Load tinggi (${averageLoad.toFixed(2)}; ` +
      `${cores} core)`
    )
  }

  if (memory.percent >= 85) {
    warnings.push(`RAM hampir penuh (${memory.percent.toFixed(1)}%)`)
  }

  if (disk.percent >= 90) {
    warnings.push(`Disk hampir penuh (${disk.percent.toFixed(1)}%)`)
  }

  if (
    processInfo.topCpu.length > 0 &&
    processInfo.topCpu[0].cpu >= 100
  ) {
    const top = processInfo.topCpu[0]

    warnings.push(
      `Proses berat: ${top.name} PID ${top.pid} ` +
      `(${top.cpu.toFixed(1)}% CPU)`
    )
  }

  return [...new Set(warnings)]
}

const pluginConfig = {
  name: "vps",
  alias: ['server', 'monitor', 'htop'],
  category: "owner",
  description: "Monitor resource VPS dan proses teratas",
  usage: ".vps",
  example: ".vps",
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  isAdmin: false,
  isBotAdmin: false,
  cooldown: 0,
  limit: 1,
  isEnabled: true,
};

async function handler(ctx) {
    await ctx.react('📊').catch(() => {})
    await ctx.reply('🔎 Membaca statistik VPS...')

    try {
      const [
        cpuUsage,
        memory,
        disk,
        ssh,
        processInfo
      ] = await Promise.all([
        getCpuUsage(),
        getMemoryInfo(),
        getDiskInfo(),
        getSshStatus(),
        getProcessInfo()
      ])

      const load = os.loadavg()
      const cores = os.cpus().length || 1

      const warnings = getWarnings({
        cpuUsage,
        load,
        cores,
        memory,
        disk,
        processInfo
      })

      const cpuIcon = statusIcon(cpuUsage, 60, 85)
      const memoryIcon = statusIcon(memory.percent, 60, 85)
      const diskIcon = statusIcon(disk.percent, 70, 90)

      const cpuSection =
        `${cpuIcon} ${bar(cpuUsage)} ${cpuUsage.toFixed(1)}%\n` +
        `├ Core: ${cores}\n` +
        `└ Load: ${load.map((value) => value.toFixed(2)).join(' / ')}` +
        ` (1m / 5m / 15m)`

      const memorySection =
        `${memoryIcon} ${bar(memory.percent)} ` +
        `${memory.percent.toFixed(1)}%\n` +
        `└ ${fmtBytes(memory.used)} / ${fmtBytes(memory.total)}`

      const swapSection =
        memory.swapTotal > 0
          ? `${statusIcon(memory.swapPercent, 60, 85)} ` +
            `${bar(memory.swapPercent)} ` +
            `${memory.swapPercent.toFixed(1)}%\n` +
            `└ ${fmtBytes(memory.swapUsed)} / ` +
            `${fmtBytes(memory.swapTotal)}`
          : '└ ⚪ Tidak aktif / tidak tersedia'

      const diskSection =
        disk.total > 0
          ? `${diskIcon} ${fmtBytes(disk.used)} / ` +
            `${fmtBytes(disk.total)} (${disk.percent.toFixed(1)}%)`
          : '⚪ Tidak bisa membaca disk'

      const warningSection = warnings.length
        ? `\n\n⚠️ *Indikasi masalah:*\n` +
          warnings.map((item) => `• ${item}`).join('\n')
        : '\n\n✅ *Indikasi masalah:*\nTidak ada indikasi kritis.'

      const message =
        `📊 *VPS MONITOR*\n` +
        `├ 🖥️ Host: \`${os.hostname()}\`\n` +
        `├ 🐧 OS: ${os.platform()}/${os.arch()}\n` +
        `├ ⏱️ Uptime: ${fmtUptime(os.uptime())}\n` +
        `├ 🔐 SSH: ${ssh.icon} ${ssh.text}\n` +
        `└ 🧵 Tasks: ${processInfo.taskCount} proses\n\n` +

        `*CPU*\n` +
        `${cpuSection}\n\n` +

        `*RAM*\n` +
        `${memorySection}\n\n` +

        `*Swap*\n` +
        `${swapSection}\n\n` +

        `*Disk / Filesystem Root*\n` +
        `└ ${diskSection}\n\n` +

        `*🔥 Top CPU*\n` +
        formatProcessList(processInfo.topCpu, 'cpu') +
        `\n\n` +

        `*🧠 Top RAM*\n` +
        formatProcessList(processInfo.topMemory, 'memory') +
        warningSection

      await ctx.reply(message)
      await ctx.react('✅').catch(() => {})
    } catch (err) {
      await ctx.react('❌').catch(() => {})
      await ctx.reply(
        `❌ Gagal membaca statistik VPS: ` +
        `${String(err.message ?? err).slice(0, 200)}`
      )
    }
  }

export { pluginConfig as config, handler };
