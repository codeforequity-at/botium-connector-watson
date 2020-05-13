const BotiumConnectorWatson = require('./src/connector')
const { importHandler, importArgs, importWatsonLogConvos, importWatsonLogIntents } = require('./src/watsonintents')
const { exportHandler, exportArgs } = require('./src/watsonintents')
const { extractIntentUtterances, trainIntentUtterances, cleanupIntentUtterances } = require('./src/nlp')

module.exports = {
  PluginVersion: 1,
  PluginClass: BotiumConnectorWatson,
  Import: {
    Handler: importHandler,
    Args: importArgs
  },
  Export: {
    Handler: exportHandler,
    Args: exportArgs
  },
  Utils: {
    importWatsonLogConvos,
    importWatsonLogIntents
  },
  NLP: {
    ExtractIntentUtterances: extractIntentUtterances,
    TrainIntentUtterances: trainIntentUtterances,
    CleanupIntentUtterances: cleanupIntentUtterances
  }
}
