const AssistantV1 = require('ibm-watson/assistant/v1')
const { IamAuthenticator, BasicAuthenticator, BearerTokenAuthenticator } = require('ibm-watson/auth')
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
  },
  PluginDesc: {
    name: 'IBM Watson Assistant',
    provider: 'IBM',
    features: {
      intentResolution: true,
      intentConfidenceScore: true,
      alternateIntents: true,
      entityResolution: true
    },
    capabilities: [
      {
        name: 'WATSON_USER',
        label: 'Service Username',
        type: 'string',
        required: false
      },
      {
        name: 'WATSON_PASSWORD',
        label: 'Service Password',
        type: 'secret',
        required: false
      },
      {
        name: 'WATSON_APIKEY',
        label: 'IAM API Key for IBM Watson',
        type: 'secret',
        required: false
      },
      {
        name: 'WATSON_BEARER',
        label: 'Bearer token for IBM Watson CP4D',
        type: 'secret',
        required: false
      }
      {
        name: 'WATSON_WELCOME_MESSAGE',
        label: 'Trigger Welcome Message',
        type: 'string',
        helperText: 'Trigger a welcome message from IBM Watson by sending some input upfront (for example "WELCOME")',
        required: false
      },
      {
        name: 'WATSON_URL',
        label: 'Service Endpoint',
        type: 'choice',
        required: true,
        choices: [
          { name: 'Dallas', key: 'https://api.us-south.assistant.watson.cloud.ibm.com' },
          { name: 'Washington, DC', key: 'https://api.us-east.assistant.watson.cloud.ibm.com' },
          { name: 'Frankfurt', key: 'https://api.eu-de.assistant.watson.cloud.ibm.com' },
          { name: 'Sydney', key: 'https://api.au-syd.assistant.watson.cloud.ibm.com' },
          { name: 'Tokyo', key: 'https://api.jp-tok.assistant.watson.cloud.ibm.com' },
          { name: 'London', key: 'https://api.eu-gb.assistant.watson.cloud.ibm.com' },
          { name: 'Seoul', key: 'https://api.kr-seo.assistant.watson.cloud.ibm.com' },
          { name: '(legacy) Dallas, US South / United Kingdom', key: 'https://gateway.watsonplatform.net/assistant/api' },
          { name: '(legacy) Washington, DC, US East', key: 'https://gateway-wdc.watsonplatform.net/assistant/api' },
          { name: '(legacy) Frankfurt, Germany', key: 'https://gateway-fra.watsonplatform.net/assistant/api' },
          { name: '(legacy) Sydney', key: 'https://gateway-syd.watsonplatform.net/assistant/api' },
          { name: '(legacy) Tokyo', key: 'https://gateway-tok.watsonplatform.net/assistant/api' },
          { name: '(legacy) London', key: 'https://gateway-lon.watsonplatform.net/assistant/api' }
        ]
      },
      {
        name: 'WATSON_ASSISTANT_VERSION',
        label: 'Assistant SDK Version',
        type: 'choice',
        required: true,
        choices: [
          { name: 'Assistant V1', key: 'V1' },
          { name: 'Assistant V2', key: 'V2' }
        ]
      },
      {
        name: 'WATSON_ASSISTANT_ID',
        label: 'Assistant Id (for Assistant V2)',
        type: 'string',
        helperText: 'To find the assistant ID in the Watson Assistant user interface, open the assistant settings and click API Details.',
        required: false
      },
      {
        name: 'WATSON_WORKSPACE_ID',
        label: 'Workspace (for Assistant V1)',
        type: 'query',
        required: false,
        query: async (caps) => {
          if (caps && ((caps.WATSON_USER && caps.WATSON_PASSWORD) || caps.WATSON_APIKEY || caps.WATSON_BEARER) && caps.WATSON_URL) {
            return new Promise((resolve, reject) => {
              const opts = {
                url: caps.WATSON_URL,
                version: '2020-04-01'
              }
              if (caps.WATSON_APIKEY) {
                opts.authenticator = new IamAuthenticator({
                  apikey: caps.WATSON_APIKEY
                })
              } else if (caps.WATSON_BEARER) {
                opts.authenticator = new BearerTokenAuthenticator({
                  bearerToken: caps.WATSON_BEARER
                })
              }
              } else {
                opts.authenticator = new BasicAuthenticator({
                  username: caps.WATSON_USER,
                  password: caps.WATSON_PASSWORD
                })
              }

              const assistant = new AssistantV1(opts)

              assistant.listWorkspaces((err, response) => {
                if (err) {
                  reject(err)
                } else {
                  const dd = response.result && response.result.workspaces && response.result.workspaces.map(w => ({ name: w.name, key: w.workspace_id }))
                  resolve(dd || [])
                }
              })
            })
          }
        }
      }
    ]
  }
}
