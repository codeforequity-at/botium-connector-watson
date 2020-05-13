#!/usr/bin/env node
const yargsCmd = require('yargs')
const slug = require('slug')
const fs = require('fs')
const path = require('path')
const mkdirp = require('mkdirp')
const XLSX = require('xlsx')
const { BotDriver } = require('botium-core')

const { importHandler, importArgs, importWatsonLogConvos, importWatsonLogIntents } = require('../src/watsonintents')
const { exportHandler, exportArgs } = require('../src/watsonintents')
const debug = require('debug')('botium-connector-watson-cli')

const writeConvosExcel = (compiler, convos, outputDir, filenamePrefix) => {
  const filename = path.resolve(outputDir, slug(filenamePrefix) + '.xlsx')

  mkdirp.sync(outputDir)

  const scriptData = compiler.Decompile(convos, 'SCRIPTING_FORMAT_XSLX')

  fs.writeFileSync(filename, scriptData)
  return filename
}

const writeIntentsExcel = (buffer, outputDir, filenamePrefix) => {
  const filename = path.resolve(outputDir, slug(filenamePrefix) + '.xlsx')

  mkdirp.sync(outputDir)

  fs.writeFileSync(filename, buffer)
  return filename
}

const writeConvo = (compiler, convo, outputDir) => {
  const filename = path.resolve(outputDir, slug(convo.header.name) + '.convo.txt')

  mkdirp.sync(outputDir)

  const scriptData = compiler.Decompile([convo], 'SCRIPTING_FORMAT_TXT')

  fs.writeFileSync(filename, scriptData)
  return filename
}

const writeUtterances = (compiler, utterance, samples, outputDir) => {
  const filename = path.resolve(outputDir, slug(utterance) + '.utterances.txt')

  mkdirp.sync(outputDir)

  const scriptData = [utterance, ...samples].join('\n')

  fs.writeFileSync(filename, scriptData)
  return filename
}

yargsCmd.usage('Botium Connector Watson CLI\n\nUsage: $0 [options]') // eslint-disable-line
  .help('help').alias('help', 'h')
  .version('version', require('../package.json').version).alias('version', 'V')
  .showHelpOnFail(true)
  .strict(true)
  .command({
    command: 'import',
    describe: 'Downloading Convos and Utterances from IBM Watson Assistant to Botium',
    builder: (yargs) => {
      for (const arg of Object.keys(importArgs)) {
        if (importArgs[arg].skipCli) continue
        yargs.option(arg, importArgs[arg])
      }
      yargs.option('output', {
        describe: 'Output directory',
        type: 'string',
        default: '.'
      })
    },
    handler: async (argv) => {
      const outputDir = argv.output

      let convos = []
      let utterances = []
      try {
        ({ convos, utterances } = await importHandler(argv))
      } catch (err) {
        console.log(`FAILED: ${err.message}`)
        return
      }

      const driver = new BotDriver()
      const compiler = await driver.BuildCompiler()

      for (const convo of convos) {
        try {
          const filename = writeConvo(compiler, convo, outputDir)
          console.log(`SUCCESS: wrote convo to file ${filename}`)
        } catch (err) {
          console.log(`WARNING: writing convo "${convo.header.name}" failed: ${err.message}`)
        }
      }
      for (const utterance of utterances) {
        try {
          const filename = writeUtterances(compiler, utterance.name, utterance.utterances, outputDir)
          console.log(`SUCCESS: wrote utterances to file ${filename}`)
        } catch (err) {
          console.log(`WARNING: writing utterances "${utterance.name}" failed: ${err.message}`)
        }
      }
    }
  })
  .command({
    command: 'export',
    describe: 'Uploading Utterances from Botium to IBM Watson Assistant',
    builder: (yargs) => {
      for (const arg of Object.keys(exportArgs)) {
        if (exportArgs[arg].skipCli) continue
        yargs.option(arg, exportArgs[arg])
      }
      yargs.option('input', {
        describe: 'Input directory',
        type: 'string',
        default: '.'
      })
    },
    handler: async (argv) => {
      const inputDir = argv.input

      const driver = new BotDriver()
      const compiler = driver.BuildCompiler()
      compiler.ReadScriptsFromDirectory(inputDir)

      const convos = []
      const utterances = Object.keys(compiler.utterances).reduce((acc, u) => acc.concat([compiler.utterances[u]]), [])

      try {
        await exportHandler(argv, { convos, utterances }, { statusCallback: (log, obj) => console.log(log, obj) })
      } catch (err) {
        console.log(`FAILED: ${err.message}`)
      }
    }
  })
  .command({
    command: 'importlogs',
    describe: 'Importing Convos and Utterances from IBM Watson Assistant Logs to Botium',
    builder: (yargs) => {
      yargs.option('watsonfilter', {
        describe: 'Filter for downloading the watson logs, for example "response_timestamp>=2018-08-20,response_timestamp<2018-08-22"'
      })
      yargs.option('watsonformat', {
        describe: 'Format for downloading the watson logs. "convo" for full conversations, "intent" for intent-list only',
        default: 'convo',
        choices: ['convo', 'intent']
      })
      yargs.option('output', {
        describe: 'Output directory',
        type: 'string',
        default: '.'
      })
    },
    handler: async (argv) => {
      const outputDir = argv.output

      if (argv.watsonformat === 'intent') {
        try {
          const { workspace, data } = await importWatsonLogIntents({ watsonfilter: argv.watsonfilter })
          const wb = XLSX.utils.book_new()
          const ws = XLSX.utils.json_to_sheet(data, { header: ['conversation_id', 'date', 'last_intent', 'last_input', 'last_output'] })
          XLSX.utils.book_append_sheet(wb, ws, 'Botium')
          const xlsxOutput = XLSX.write(wb, { type: 'buffer' })
          debug(`Watson logs got ${data.length} intent lines`)

          try {
            const filename = writeIntentsExcel(xlsxOutput, outputDir, workspace.name)
            console.log(`SUCCESS: wrote intents to file ${filename}`)
          } catch (err) {
            throw new Error(`ERROR: writing intents failed: ${err.message}`)
          }
        } catch (err) {
          console.log(`FAILED: ${err.message}`)
        }
      } else {
        try {
          const { workspace, data, compiler } = await importWatsonLogConvos({ watsonfilter: argv.watsonfilter })
          try {
            const filename = writeConvosExcel(compiler, data, outputDir, workspace.name)
            console.log(`SUCCESS: wrote convos to file ${filename}`)
          } catch (err) {
            throw new Error(`ERROR: writing convos failed: ${err.message}`)
          }
        } catch (err) {
          console.log(`FAILED: ${err.message}`)
        }
      }
    }
  })
  .argv
