const util = require('util')
const slug = require('slug')
const fs = require('fs')
const path = require('path')
const mkdirp = require('mkdirp')
const debug = require('debug')('botium-connector-watson-helper')

module.exports.writeConvosExcel = (compiler, convos, outputDir, filenamePrefix) => {
  const filename = path.resolve(outputDir, slug(filenamePrefix) + '.xlsx')

  mkdirp.sync(outputDir)

  const scriptData = compiler.Decompile(convos, 'SCRIPTING_FORMAT_XSLX')

  fs.writeFileSync(filename, scriptData)
  return filename
}

module.exports.writeIntentsExcel = (buffer, outputDir, filenamePrefix) => {
  const filename = path.resolve(outputDir, slug(filenamePrefix) + '.xlsx')

  mkdirp.sync(outputDir)

  fs.writeFileSync(filename, buffer)
  return filename
}

module.exports.writeConvo = (compiler, convo, outputDir) => {
  const filename = path.resolve(outputDir, slug(convo.header.name) + '.convo.txt')

  mkdirp.sync(outputDir)

  const scriptData = compiler.Decompile([convo], 'SCRIPTING_FORMAT_TXT')

  fs.writeFileSync(filename, scriptData)
  return filename
}

module.exports.writeUtterances = (compiler, utterance, samples, outputDir) => {
  const filename = path.resolve(outputDir, slug(utterance) + '.utterances.txt')

  mkdirp.sync(outputDir)

  const scriptData = [utterance, ...samples].join('\n')

  fs.writeFileSync(filename, scriptData)
  return filename
}

module.exports.waitWorkspaceAvailable = async (assistant, workspaceId, interval) => {
  const timeout = ms => new Promise(resolve => setTimeout(resolve, ms))
  while (true) {
    debug(`Watson checking workspace status ${workspaceId}`)
    try {
      const workspaceAvailable = await new Promise((resolve, reject) => {
        assistant.getWorkspace({ workspaceId: workspaceId }, (err, workspace) => {
          if (err) {
            reject(new Error(`Watson workspace connection failed: ${err.message}`))
          } else if (workspace.result) {
            debug(`Watson workspace connected, checking for status 'Available': ${util.inspect(workspace.result)}`)
            if (workspace.result.status === 'Available') {
              resolve(true)
            } else {
              debug('Watson workspace waiting for status \'Available\'')
              resolve(false)
            }
          } else {
            reject(new Error('Watson workspace connection failed: result empty'))
          }
        })
      })
      if (workspaceAvailable) {
        return
      } else {
        await timeout(interval || 5000)
      }
    } catch (err) {
      debug(`Watson workspace error on availability check ${err.message}`)
      await timeout(interval || 5000)
    }
  }
}
