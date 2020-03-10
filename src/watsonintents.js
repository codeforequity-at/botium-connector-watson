const util = require('util')
const path = require('path')
const slug = require('slug')
const botium = require('botium-core')
const debug = require('debug')('botium-connector-watson-intents')

const getCaps = (caps) => {
  const result = caps || {}
  result[botium.Capabilities.CONTAINERMODE] = path.resolve(__dirname, '..', 'index.js')
  result.WATSON_COPY_WORKSPACE = false
  return result
}

const importWatsonIntents = async ({ caps, buildconvos, buildentities }) => {
  const driver = new botium.BotDriver(getCaps(caps))
  const container = await driver.Build()
  const compiler = await driver.BuildCompiler()

  if (container.pluginInstance.caps.WATSON_ASSISTANT_VERSION !== 'V1') {
    throw new Error('FAILED: Currently only supported with Watson Assistant API V1')
  }

  const workspace = await (new Promise((resolve, reject) => {
    container.pluginInstance.assistant.getWorkspace({
      workspaceId: driver.caps.WATSON_WORKSPACE_ID,
      _export: true
    }, (err, workspace) => {
      if (err) {
        reject(new Error(`Watson workspace connection failed: ${util.inspect(err)}`))
      } else {
        debug(`Got Watson workspace ${workspace.name}`)
        resolve(workspace)
      }
    })
  }))

  const convos = []
  const utterances = []

  if (buildconvos) {
    debug(`Watson workspace got intents: ${JSON.stringify(workspace.result.intents, null, 2)}`)
  }
  for (const intent of (workspace.result.intents || [])) {
    const inputUtterances = (intent.examples && intent.examples.map((e) => e.text)) || []

    if (buildconvos) {
      const utterancesRef = `UTT_INTENT_${slug(intent.intent).toUpperCase()}`
      const convo = {
        header: {
          name: intent.intent
        },
        conversation: [
          {
            sender: 'me',
            messageText: utterancesRef
          },
          {
            sender: 'bot',
            asserters: [
              {
                name: 'INTENT',
                args: [intent.intent]
              }
            ]
          }
        ]
      }
      convos.push(convo)
      utterances.push({
        name: utterancesRef,
        utterances: inputUtterances
      })
    } else {
      utterances.push({
        name: intent.intent,
        utterances: inputUtterances
      })
    }
  }

  if (buildentities) {
    debug(`Watson workspace got entities: ${JSON.stringify(workspace.result.entities, null, 2)}`)
    for (const entity of (workspace.result.entities || [])) {
      for (const entityValue of entity.values) {
        const inputUtterances = [entityValue.value, ...(entityValue.synonyms || [])]

        const utterancesRef = `UTT_ENTITY_${slug(entity.entity).toUpperCase()}_${slug(entityValue.value).toUpperCase()}`
        const convo = {
          header: {
            name: `${entity.entity} = ${entityValue.value}`
          },
          conversation: [
            {
              sender: 'me',
              messageText: utterancesRef
            },
            {
              sender: 'bot',
              asserters: [
                {
                  name: 'ENTITY_CONTENT',
                  args: [entity.entity, entityValue.value]
                }
              ]
            }
          ]
        }
        convos.push(convo)
        utterances.push({
          name: utterancesRef,
          utterances: inputUtterances
        })
      }
    }
  }

  return { convos, utterances, driver, container, compiler }
}

const importWatsonLogs = async ({ caps, watsonfilter }, conversion) => {
  const driver = new botium.BotDriver(getCaps(caps))
  const container = await driver.Build()
  const compiler = await driver.BuildCompiler()

  if (container.pluginInstance.caps.WATSON_ASSISTANT_VERSION !== 'V1') {
    throw new Error('FAILED: Currently only supported with Watson Assistant API V1')
  }

  const workspace = await (new Promise((resolve, reject) => {
    container.pluginInstance.assistant.getWorkspace({
      workspaceId: driver.caps.WATSON_WORKSPACE_ID,
      export: false
    }, (err, workspace) => {
      if (err) {
        reject(new Error(`Watson workspace connection failed: ${util.inspect(err)}`))
      } else {
        debug(`Got Watson workspace ${workspace.result.name}`)
        resolve(workspace.result)
      }
    })
  }))

  let logs = []
  let hasMore = true

  const pageParams = {
    workspaceId: driver.caps.WATSON_WORKSPACE_ID,
    pageLimit: 1000,
    sort: 'request_timestamp',
    watsonfilter
  }
  while (hasMore) {
    debug(`Watson workspace gettings logs page: ${pageParams.cursor}`)
    await (new Promise((resolve, reject) => {
      container.pluginInstance.assistant.listLogs(pageParams, (err, pageResult) => {
        if (err) {
          reject(new Error(`Watson workspace connection failed: ${util.inspect(err)}`))
        } else {
          logs = logs.concat(pageResult.result.logs)
          if (pageResult.result.pagination && pageResult.result.pagination.next_cursor) {
            hasMore = true
            pageParams.cursor = pageResult.result.pagination.next_cursor
          } else {
            hasMore = false
          }
          resolve()
        }
      })
    }))
  }
  debug(`Watson workspace got ${logs.length} log entries`)
  if (logs.length === 0) {
    throw new Error('Watson conversation returned no logs')
  }
  try {
    await container.Clean()
  } catch (err) {
    debug(`Error container cleanup: ${util.inspect(err)}`)
  }

  const data = conversion(logs)
  return { workspace, data, driver, container, compiler }
}

const convertLogToConvos = (logs) => {
  const convos = []
  const convosById = {}

  logs.forEach((log) => {
    const conversationId = log.response.context.conversation_id

    let convo = { header: {}, conversation: [] }
    if (convosById[conversationId]) {
      convo = convosById[conversationId]
    } else {
      convosById[conversationId] = convo
      convos.push(convo)
    }

    if (log.request.input && log.request.input.text) {
      convo.conversation.push({ sender: 'me', messageText: log.request.input.text, timestamp: log.request_timestamp })
    }
    if (log.response.output && log.response.output.text) {
      log.response.output.text.forEach((messageText) => {
        const convoStep = {
          sender: 'bot',
          timestamp: log.response_timestamp
        }
        const intent = log.response.intents && log.response.intents.length > 0 && log.response.intents[0].intent
        if (intent) {
          convoStep.asserters = [
            {
              name: 'INTENT',
              args: [intent]
            }
          ]
        }
        if (messageText) {
          convoStep.messageText = messageText
        }
        convo.conversation.push(convoStep)
      })
    }
  })
  debug(`Watson logs got ${convos.length} convos`)
  return convos
}

const convertLogToList = (logs) => {
  const data = []
  logs.forEach((log) => {
    data.push({
      conversation_id: (log.response.context && log.response.context.conversation_id) || '',
      date: log.request_timestamp,
      last_intent: (log.response.intents && log.response.intents.length > 0 && log.response.intents[0].intent) || '',
      last_input: (log.request.input && log.request.input.text) || '',
      last_output: (log.response.output && log.response.output.text && log.response.output.text.length > 0 && log.response.output.text[0]) || ''
    })
  })
  return data
}

module.exports = {
  importHandler: ({ caps, buildconvos, buildentities, ...rest } = {}) => importWatsonIntents({ caps, buildconvos, buildentities, ...rest }),
  importArgs: {
    caps: {
      describe: 'Capabilities',
      type: 'json',
      skipCli: true
    },
    buildconvos: {
      describe: 'Build convo files for intent assertions (otherwise, just write utterances files)',
      type: 'boolean',
      default: true
    },
    buildentities: {
      describe: 'Add entity asserters to convo files',
      type: 'boolean',
      default: false
    }
  },
  importWatsonLogConvos: ({ caps, watsonfilter, ...rest }) => importWatsonLogs({ caps, watsonfilter, ...rest }, convertLogToConvos),
  importWatsonLogIntents: ({ caps, watsonfilter, ...rest }) => importWatsonLogs({ caps, watsonfilter, ...rest }, convertLogToList)
}
