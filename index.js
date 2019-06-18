const BotiumConnectorWatson = require('./src/connector')
const { importWatsonIntents, importWatsonLogs } = require('./src/watsonintents')

module.exports = {
  PluginVersion: 1,
  PluginClass: BotiumConnectorWatson,
  Utils: {
    importWatsonIntents,
    importWatsonLogs
  }
}
