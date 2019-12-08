const BotiumConnectorWatson = require('./src/connector')
const { importWatsonIntents, importWatsonLogs } = require('./src/watsonintents')
const { extractIntentUtterances, trainIntentUtterances, cleanupIntentUtterances } = require('./src/nlp')

module.exports = {
  PluginVersion: 1,
  PluginClass: BotiumConnectorWatson,
  Utils: {
    importWatsonIntents,
    importWatsonLogs
  },
  NLP: {
    ExtractIntentUtterances: extractIntentUtterances,
    TrainIntentUtterances: trainIntentUtterances,
    CleanupIntentUtterances: cleanupIntentUtterances
  }
}
