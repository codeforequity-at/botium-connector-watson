const util = require('util')
const path = require('path')
const slug = require('slug')
const randomize = require('randomatic')
const botium = require('botium-core')
const _ = require('lodash')
const { getWorkspace, createWorkspace, updateWorkspace, waitWorkspaceAvailable } = require('./helpers')
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

  const workspace = await getWorkspace(container.pluginInstance.assistant, driver.caps.WATSON_WORKSPACE_ID)

  const convos = []
  const utterances = []

  if (buildconvos) {
    debug(`Watson workspace got intents: ${JSON.stringify(workspace.intents, null, 2)}`)
  }
  for (const intent of (workspace.intents || [])) {
    const inputUtterances = (intent.examples && intent.examples.map((e) => e.text)) || []

    utterances.push({
      name: intent.intent,
      utterances: inputUtterances
    })

    if (buildconvos) {
      const convo = {
        header: {
          name: intent.intent
        },
        conversation: [
          {
            sender: 'me',
            messageText: intent.intent
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
    }
  }

  if (buildentities) {
    debug(`Watson workspace got entities: ${JSON.stringify(workspace.entities, null, 2)}`)
    for (const entity of (workspace.entities || [])) {
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

const exportWatsonIntents = async ({ caps, newWorkspaceName, newWorkspaceLanguage, uploadmode, waitforavailable }, { convos, utterances }, { statusCallback }) => {
  const driver = new botium.BotDriver(getCaps(caps))
  const container = await driver.Build()

  if (container.pluginInstance.caps.WATSON_ASSISTANT_VERSION !== 'V1') {
    throw new Error('FAILED: Currently only supported with Watson Assistant API V1')
  }

  let workspace = {}
  let newWorkspace = {}

  const status = (log, obj) => {
    debug(log, obj)
    if (statusCallback) statusCallback(log, obj)
  }

  const updateIntentExamples = () => {
    if (!workspace.intents) workspace.intents = []
    for (const utt of utterances) {
      const wintent = workspace.intents.find(i => i.intent === utt.name)
      if (wintent) {
        for (const ex of (utt.utterances || [])) {
          if (wintent.examples && wintent.examples.find(we => we.text === ex)) continue
          else wintent.examples.push({ text: ex })
        }
      } else {
        workspace.intents.push({
          intent: utt.name,
          examples: (utt.utterances || []).map(u => ({
            text: u
          }))
        })
      }
    }
  }

  if (uploadmode === 'update') {
    workspace = await getWorkspace(container.pluginInstance.assistant, driver.caps.WATSON_WORKSPACE_ID, true)
    workspace = _.pick(workspace, ['workspaceId', 'intents'])
    workspace.append = false

    updateIntentExamples()

    newWorkspace = await updateWorkspace(container.pluginInstance.assistant, workspace, true)
    status(`Updated workspace ${newWorkspace.name}`, { workspaceId: newWorkspace.workspaceId })
  } else if (uploadmode === 'copy') {
    workspace = await getWorkspace(container.pluginInstance.assistant, driver.caps.WATSON_WORKSPACE_ID, true)
    if (newWorkspaceName) workspace.name = newWorkspaceName
    else workspace.name = `${workspace.name}-Copy-${randomize('Aa0', 5)}`
    delete workspace.workspaceId

    updateIntentExamples()
    newWorkspace = await createWorkspace(container.pluginInstance.assistant, workspace, true)
    status(`Copied workspace to ${newWorkspace.name}`, { workspaceId: newWorkspace.workspaceId })
  } else {
    workspace = {
      name: newWorkspaceName || `Botium-${randomize('Aa0', 5)}`,
      language: newWorkspaceLanguage
    }

    updateIntentExamples()
    newWorkspace = await createWorkspace(container.pluginInstance.assistant, workspace, true)
    status(`Created workspace ${newWorkspace.name}`, { workspaceId: newWorkspace.workspaceId })
  }

  if (waitforavailable) {
    status(`Waiting for workspace ${newWorkspace.name} to become available`, { workspaceId: newWorkspace.workspaceId })
    await waitWorkspaceAvailable(container.pluginInstance.assistant, newWorkspace.workspaceId)
    status(`Workspace ${newWorkspace.name} is available and ready for use`, { workspaceId: newWorkspace.workspaceId })
  }
  
  const newCaps = _.pickBy(driver.caps, (value, key) => key.startsWith('WATSON_'))
  newCaps.WATSON_WORKSPACE_ID = newWorkspace.workspaceId
  return { caps: newCaps, workspaceId: newWorkspace.workspaceId }
}

const importWatsonLogs = async ({ caps, watsonfilter }, conversion) => {
  const driver = new botium.BotDriver(getCaps(caps))
  const container = await driver.Build()
  const compiler = await driver.BuildCompiler()

  if (container.pluginInstance.caps.WATSON_ASSISTANT_VERSION !== 'V1') {
    throw new Error('FAILED: Currently only supported with Watson Assistant API V1')
  }

  const workspace = await getWorkspace(container.pluginInstance.assistant, driver.caps.WATSON_WORKSPACE_ID)

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

    try {
      const pageResult = await container.pluginInstance.assistant.listLogs(pageParams)
      logs = logs.concat(pageResult.result.logs)
      if (pageResult.result.pagination && pageResult.result.pagination.next_cursor) {
        hasMore = true
        pageParams.cursor = pageResult.result.pagination.next_cursor
      } else {
        hasMore = false
      }
    } catch (err) {
      throw new Error(`Watson workspace connection failed: ${err.message}`)
    }
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
      default: false
    },
    buildentities: {
      describe: 'Add entity asserters to convo files',
      type: 'boolean',
      default: false
    }
  },
  importWatsonLogConvos: ({ caps, watsonfilter, ...rest }) => importWatsonLogs({ caps, watsonfilter, ...rest }, convertLogToConvos),
  importWatsonLogIntents: ({ caps, watsonfilter, ...rest }) => importWatsonLogs({ caps, watsonfilter, ...rest }, convertLogToList),
  exportHandler: ({ caps, newWorkspaceName, newWorkspaceLanguage, uploadmode, waitforavailable, ...rest } = {}, { convos, utterances } = {}, { statusCallback } = {}) => exportWatsonIntents({ caps, newWorkspaceName, newWorkspaceLanguage, uploadmode, waitforavailable, ...rest }, { convos, utterances }, { statusCallback }),
  exportArgs: {
    caps: {
      describe: 'Capabilities',
      type: 'json',
      skipCli: true
    },
    uploadmode: {
      describe: 'Update the IBM Watson Assistant workspace with data from Botium, copy it before making chances, or create a blank one',
      default: 'new',
      choices: ['new', 'copy', 'update']
    },
    newWorkspaceName: {
      describe: 'Create a new IBM Watson Assistant workspace',
      type: 'string'
    },
    newWorkspaceLanguage: {
      describe: 'Language for the new workspace',
      type: 'string',
      default: 'en'
    },
    waitforavailable: {
      describe: 'Wait until new workspace finished training',
      type: 'boolean',
      default: false
    }
  }
}
