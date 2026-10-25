import { getPrimbonCommand, runPrimbonCommand } from '../../../lib/primbon.js'
const pluginConfig = (({ query, valid, format, usageText, ...config }) => config)(getPrimbonCommand('ramalanjodoh'))
async function handler(ctx) { await runPrimbonCommand(ctx, 'ramalanjodoh') }
export { pluginConfig as config, handler }
