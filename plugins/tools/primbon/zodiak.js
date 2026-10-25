import { getPrimbonCommand, runPrimbonCommand } from '../../../lib/primbon.js'
const pluginConfig = (({ query, valid, format, usageText, ...config }) => config)(getPrimbonCommand('zodiak'))
async function handler(ctx) { await runPrimbonCommand(ctx, 'zodiak') }
export { pluginConfig as config, handler }
