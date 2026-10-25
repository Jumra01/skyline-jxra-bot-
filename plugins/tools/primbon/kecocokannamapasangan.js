import { getPrimbonCommand, runPrimbonCommand } from '../../../lib/primbon.js'
const pluginConfig = (({ query, valid, format, usageText, ...config }) => config)(getPrimbonCommand('kecocokannamapasangan'))
async function handler(ctx) { await runPrimbonCommand(ctx, 'kecocokannamapasangan') }
export { pluginConfig as config, handler }
