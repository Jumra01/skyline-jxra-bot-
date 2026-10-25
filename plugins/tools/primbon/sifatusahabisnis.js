import { getPrimbonCommand, runPrimbonCommand } from '../../../lib/primbon.js'
const pluginConfig = (({ query, valid, format, usageText, ...config }) => config)(getPrimbonCommand('sifatusahabisnis'))
async function handler(ctx) { await runPrimbonCommand(ctx, 'sifatusahabisnis') }
export { pluginConfig as config, handler }
