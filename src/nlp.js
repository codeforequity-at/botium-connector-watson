const util = require('util')
const path = require('path')
const randomize = require('randomatic')
const botium = require('botium-core')
const debug = require('debug')('botium-connector-watson-nlp')

const { waitWorkspaceAvailable } = require('./helpers')

const getCaps = (caps) => {
  const result = Object.assign({}, caps || {})
  result.CONTAINERMODE = path.resolve(__dirname, '..', 'index.js')
  result.WATSON_ASSISTANT_VERSION = 'V1'
  result.WATSON_COPY_WORKSPACE = false
  result.WATSON_FORCE_INTENT_RESOLUTION = true
  return result
}

const extractIntentUtterances = async ({ caps }) => {
  const driver = new botium.BotDriver(getCaps(caps))
  const container = await driver.Build()

  try {
    const workspace = await (new Promise((resolve, reject) => {
      container.pluginInstance.assistant.getWorkspace({
        workspaceId: driver.caps.WATSON_WORKSPACE_ID,
        _export: true
      }, (err, workspace) => {
        if (err) {
          reject(new Error(`Watson workspace connection failed: ${util.inspect(err)}`))
        } else if (workspace.result) {
          debug(`Got Watson workspace ${workspace.result.name}`)
          resolve(workspace.result)
        } else {
          reject(new Error('Watson workspace connection failed: result empty'))
        }
      })
    }))
    debug(`Watson workspace got intents: ${JSON.stringify(workspace.intents, null, 2)}`)

    const intents = []

    for (const intent of (workspace.intents || [])) {
      const intentName = intent.intent
      const utterances = (intent.examples && intent.examples.map((e) => e.text)) || []
      intents.push({
        intentName,
        utterances
      })
    }
    return {
      intents,
      origWorkspace: workspace
    }
  } finally {
    if (container) await container.Clean()
  }
}

const trainIntentUtterances = async ({ caps }, intents, { origWorkspace }) => {
  const driver = new botium.BotDriver(getCaps(caps))
  const container = await driver.Build()

  const newWorkspaceData = {
    name: `${origWorkspace ? origWorkspace.name : 'Botium'}-TrainingCopy-${randomize('Aa0', 5)}`,
    language: origWorkspace && origWorkspace.language,
    intents: (intents || []).map(intent => ({
      intent: intent.intentName,
      examples: (intent.utterances || []).map(u => ({
        text: u
      }))
    }))
  }
  try {
    const newWorkspace = await (new Promise((resolve, reject) => {
      container.pluginInstance.assistant.createWorkspace(newWorkspaceData, (err, workspace) => {
        if (err) {
          reject(new Error(`Watson workspace connection failed: ${util.inspect(err)}`))
        } else if (workspace.result) {
          debug(`Created Watson workspace ${workspace.result.name}`)
          resolve(workspace.result)
        } else {
          reject(new Error('Watson workspace connection failed: result empty'))
        }
      })
    }))
    debug(`Watson workspace created: ${newWorkspace.workspace_id}/${newWorkspace.name}`)

    await waitWorkspaceAvailable(container.pluginInstance.assistant, newWorkspace.workspace_id)
    debug(`Watson workspace available: ${newWorkspace.workspace_id}/${newWorkspace.name}`)

    return {
      caps: Object.assign({}, getCaps(caps), {
        WATSON_WORKSPACE_ID: newWorkspace.workspace_id
      }),
      origWorkspace,
      tempWorkspace: newWorkspace
    }
  } finally {
    if (container) await container.Clean()
  }
}

const cleanupIntentUtterances = async ({ caps }, { caps: trainCaps, origWorkspace, tempWorkspace }) => {
  const driver = new botium.BotDriver(getCaps(Object.assign(caps || {}, trainCaps || {})))
  const container = await driver.Build()

  try {
    await (new Promise((resolve, reject) => {
      container.pluginInstance.assistant.deleteWorkspace({ workspaceId: tempWorkspace.workspace_id }, (err) => {
        if (err) {
          reject(new Error(`Watson workspace delete copy failed: ${err.message}`))
        } else {
          resolve()
        }
      })
    }))
    debug(`Watson workspace deleted: ${tempWorkspace.workspace_id}/${tempWorkspace.name}`)
  } finally {
    if (container) await container.Clean()
  }
}

module.exports = {
  extractIntentUtterances,
  trainIntentUtterances,
  cleanupIntentUtterances
}
