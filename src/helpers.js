const util = require('util')
const debug = require('debug')('botium-connector-watson-helper')

const toCamel = (s) => {
  return s.replace(/([-_][a-z])/ig, ($1) => {
    return $1.toUpperCase()
      .replace('-', '')
      .replace('_', '')
  })
}

const fixCamelCase = (workspace) => {
  for (const propName of Object.keys(workspace)) {
    const cc = toCamel(propName)
    if (cc !== propName) {
      workspace[cc] = workspace[propName]
      delete workspace[propName]
    }
  }
}

module.exports.getWorkspace = async (assistant, workspaceId, forUpdate) => {
  try {
    const workspace = await assistant.getWorkspace({
      workspaceId,
      _export: true
    })
    if (workspace.result) {
      debug(`Got Watson workspace ${workspace.result.name}`)
      if (forUpdate) fixCamelCase(workspace.result)
      return workspace.result
    } else {
      throw new Error('result empty')
    }
  } catch (err) {
    throw new Error(`Watson workspace connection failed: ${err.message}`)
  }
}

module.exports.createWorkspace = async (assistant, newWorkspaceData, forUpdate) => {
  try {
    const workspace = await assistant.createWorkspace(newWorkspaceData)
    if (workspace.result) {
      debug(`Created Watson workspace ${workspace.result.name}`)
      if (forUpdate) fixCamelCase(workspace.result)
      return workspace.result
    } else {
      throw new Error('result empty')
    }
  } catch (err) {
    throw new Error(`Watson workspace creation failed: ${err.message}`)
  }
}

module.exports.updateWorkspace = async (assistant, updatedWorkspaceData, forUpdate) => {
  try {
    const workspace = await assistant.updateWorkspace(updatedWorkspaceData)
    if (workspace.result) {
      debug(`Updated Watson workspace ${workspace.result.name}`)
      if (forUpdate) fixCamelCase(workspace.result)
      return workspace.result
    } else {
      throw new Error('result empty')
    }
  } catch (err) {
    throw new Error(`Watson workspace update failed: ${err.message}`)
  }
}

module.exports.waitWorkspaceAvailable = async (assistant, workspaceId, interval) => {
  const timeout = ms => new Promise(resolve => setTimeout(resolve, ms))
  while (true) {
    debug(`Watson checking workspace status ${workspaceId}`)
    try {
      const workspace = await assistant.getWorkspace({ workspaceId: workspaceId })
      if (workspace.result) {
        debug(`Watson workspace connected, checking for status 'Available': ${util.inspect(workspace.result)}`)
        if (workspace.result.status === 'Available') {
          return
        } else {
          debug(`Watson workspace waiting for status 'Available' (status: ${workspace.result.status})`)
        }
      } else {
        debug('Watson workspace result empty')
      }
    } catch (err) {
      debug(`Watson workspace error on availability check ${err.message}`)
    }
    await timeout(interval || 5000)
  }
}

module.exports.promiseTimeout = (prom, timeout) => {
  let timeoutTimer = null

  return Promise.race([
    prom,
    ...(
      timeout && timeout > 0
        ? [new Promise((resolve, reject) => { timeoutTimer = setTimeout(() => reject(new Error(`Watson API Call did not complete within ${timeout}ms, cancelled.`)), timeout) })]
        : []
    )
  ]).finally(() => { if (timeoutTimer) clearTimeout(timeoutTimer) })
}
