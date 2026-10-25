import { getPrimbonCommand, runPrimbonCommand } from '../../../lib/primbon.js'
const pluginConfig = (({ query, valid, format, usageText, ...config }) => config)(getPrimbonCommand('potensipenyakit'))
async function handler(ctx) { await runPrimbonCommand(ctx, 'potensipenyakit') }
export { pluginConfig as config, handler }
