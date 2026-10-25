import { getPrimbonCommand, runPrimbonCommand } from '../../../lib/primbon.js'
const pluginConfig = (({ query, valid, format, usageText, ...config }) => config)(getPrimbonCommand('tafsirmimpi'))
async function handler(ctx) { await runPrimbonCommand(ctx, 'tafsirmimpi') }
export { pluginConfig as config, handler }
