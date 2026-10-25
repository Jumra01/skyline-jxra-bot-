import { getPrimbonCommand, runPrimbonCommand } from '../../../lib/primbon.js'
const pluginConfig = (({ query, valid, format, usageText, ...config }) => config)(getPrimbonCommand('nomerhoki'))
async function handler(ctx) { await runPrimbonCommand(ctx, 'nomerhoki') }
export { pluginConfig as config, handler }
