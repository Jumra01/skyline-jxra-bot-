import { getPrimbonCommand, runPrimbonCommand } from '../../../lib/primbon.js'
const pluginConfig = (({ query, valid, format, usageText, ...config }) => config)(getPrimbonCommand('artinama'))
async function handler(ctx) { await runPrimbonCommand(ctx, 'artinama') }
export { pluginConfig as config, handler }
