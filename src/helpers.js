const util = require('util')
const debug = require('debug')('botium-connector-watson-helper')

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
