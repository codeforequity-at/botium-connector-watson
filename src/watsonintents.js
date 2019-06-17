const util = require('util')
const path = require('path')
const slug = require('slug')
const XLSX = require('xlsx')
const yargsCmd = require('yargs')
const botium = require('botium-core')
const debug = require('debug')('botium-connector-watson-intents')
const helpers = require('./helpers')

const getCaps = (caps) => {
  const result = caps || {}
  result[botium.Capabilities.CONTAINERMODE] = path.resolve(__dirname, '..', 'index.js')
  result['WATSON_COPY_WORKSPACE'] = false
  return result
}

const importWatsonIntents = async (caps) => {
  const driver = new botium.BotDriver(getCaps(caps))
  const container = await driver.Build()
  const compiler = await driver.BuildCompiler()

  if (container.pluginInstance.caps['WATSON_ASSISTANT_VERSION'] !== 'V1') {
    throw new Error(`FAILED: Currently only supported with Watson Assistant API V1`)
  }

  const workspace = await (new Promise((resolve, reject) => {
    container.pluginInstance.assistant.getWorkspace({
      workspace_id: driver.caps['WATSON_WORKSPACE_ID'],
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
  debug(`Watson workspace got intents: ${JSON.stringify(workspace.intents, null, 2)}`)
  if (!workspace.intents || workspace.intents.length === 0) {
    throw new Error(`Watson workspace intents empty: ${JSON.stringify(workspace, null, 2)}`)
  }

  const convos = []
  const utterances = []

  for (const intent of workspace.intents) {
    const inputUtterances = (intent.examples && intent.examples.map((e) => e.text)) || []
    const utterancesRef = slug(intent.intent + '_input')

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
  }
  return { convos, utterances, driver, container, compiler }
}

const importWatsonLogs = async (caps, filter, conversion) => {
  const driver = new botium.BotDriver(getCaps(caps))
  const container = await driver.Build()
  const compiler = await driver.BuildCompiler()

  if (container.pluginInstance.caps['WATSON_ASSISTANT_VERSION'] !== 'V1') {
    throw new Error(`FAILED: Currently only supported with Watson Assistant API V1`)
  }

  const workspace = await (new Promise((resolve, reject) => {
    container.pluginInstance.assistant.getWorkspace({
      workspace_id: driver.caps['WATSON_WORKSPACE_ID'],
      export: false
    }, (err, workspace) => {
      if (err) {
        reject(new Error(`Watson workspace connection failed: ${util.inspect(err)}`))
      } else {
        debug(`Got Watson workspace ${workspace.name}`)
        resolve(workspace)
      }
    })
  }))

  let logs = []
  let hasMore = true

  const pageParams = {
    workspace_id: driver.caps['WATSON_WORKSPACE_ID'],
    page_limit: 1000,
    sort: 'request_timestamp',
    filter
  }
  while (hasMore) {
    debug(`Watson workspace gettings logs page: ${pageParams.cursor}`)
    await (new Promise((resolve, reject) => {
      container.pluginInstance.assistant.listLogs(pageParams, (err, pageResult) => {
        if (err) {
          reject(new Error(`Watson workspace connection failed: ${util.inspect(err)}`))
        } else {
          logs = logs.concat(pageResult.logs)
          if (pageResult.pagination && pageResult.pagination.next_cursor) {
            hasMore = true
            pageParams.cursor = pageResult.pagination.next_cursor
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
        if (messageText) convo.conversation.push({ sender: 'bot', messageText, timestamp: log.response_timestamp })
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
      last_intent: (log.response.intents && log.response.intents[0].intent) || '',
      last_input: (log.request.input && log.request.input.text) || '',
      last_output: (log.response.output && log.response.output.text && log.response.output.text[0]) || ''
    })
  })
  return data
}

const handler = (argv) => {
  debug(`command options: ${util.inspect(argv)}`)

  if (!argv.source) {
    return yargsCmd.showHelp()
  }
  if (argv.watsonformat && argv.watsonformat !== 'convo' && argv.watsonformat !== 'intent') {
    return yargsCmd.showHelp()
  }
  const outputDir = (argv.convos && argv.convos[0]) || '.'

  if (argv.source === 'watson-intents') {
    module.exports.importWatsonIntents({})
      .then(({ convos, utterances, compiler }) => {
        convos && convos.forEach(convo => {
          try {
            const filename = helpers.writeConvo(compiler, convo, outputDir)
            console.log(`SUCCESS: wrote convo to file ${filename}`)
          } catch (err) {
            console.log(`WARNING: writing convo "${convo.header.name}" failed: ${util.inspect(err)}`)
          }
        })
        utterances && utterances.forEach(utterance => {
          try {
            const filename = helpers.writeUtterances(compiler, utterance.name, utterance.utterances, outputDir)
            console.log(`SUCCESS: wrote utterances to file ${filename}`)
          } catch (err) {
            console.log(`WARNING: writing utterances "${utterance.name}" failed: ${util.inspect(err)}`)
          }
        })
      })
      .catch((err) => {
        console.log(`FAILED: ${err.message}`)
      })
  } else if (argv.source === 'watson-logs') {
    if (argv.watsonformat === 'intent') {
      importWatsonLogs({}, argv.watsonfilter, convertLogToList)
        .then(({ workspace, data }) => {
          const wb = XLSX.utils.book_new()
          const ws = XLSX.utils.json_to_sheet(data, { header: ['conversation_id', 'date', 'last_intent', 'last_input', 'last_output'] })
          XLSX.utils.book_append_sheet(wb, ws, 'Botium')
          const xlsxOutput = XLSX.write(wb, { type: 'buffer' })
          debug(`Watson logs got ${data.length} intent lines`)

          try {
            const filename = helpers.writeIntentsExcel(xlsxOutput, outputDir, workspace.name)
            console.log(`SUCCESS: wrote intents to file ${filename}`)
          } catch (err) {
            throw new Error(`ERROR: writing intents failed: ${util.inspect(err)}`)
          }
        })
        .catch((err) => {
          console.log(`FAILED: ${err.message}`)
        })
    } else {
      importWatsonLogs({}, argv.watsonfilter, convertLogToConvos)
        .then(({ workspace, data, compiler }) => {
          try {
            const filename = helpers.writeConvosExcel(compiler, data, outputDir, workspace.name)
            console.log(`SUCCESS: wrote convos to file ${filename}`)
          } catch (err) {
            throw new Error(`ERROR: writing convos failed: ${util.inspect(err)}`)
          }
        })
        .catch((err) => {
          console.log(`FAILED: ${err.message}`)
        })
    }
  }
}

module.exports = {
  importWatsonIntents: (caps) => importWatsonIntents(caps),
  importWatsonLogConvos: (caps, filter) => importWatsonLogs(caps, filter, convertLogToConvos),
  importWatsonLogIntents: (caps, filter) => importWatsonLogs(caps, filter, convertLogToList),
  args: {
    command: 'watsonimport [source]',
    describe: 'Importing conversations for Botium',
    builder: (yargs) => {
      yargs.positional('source', {
        describe: 'Specify the source of the conversations for the configured chatbot',
        choices: [ 'watson-intents', 'watson-logs' ]
      })
      yargs.option('watsonfilter', {
        describe: 'Filter for downloading the watson logs, for example "response_timestamp>=2018-08-20,response_timestamp<2018-08-22"'
      })
      yargs.option('watsonformat', {
        describe: 'Format for downloading the watson logs. "convo" for full conversations, "intent" for intent-list only (default: "convo")'
      })
    },
    handler
  }
}
