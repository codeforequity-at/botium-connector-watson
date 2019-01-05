const BotDriver = require('botium-core').BotDriver

function assert (expected, actual) {
  if (!actual || actual.indexOf(expected) < 0) {
    console.log(`ERROR: Expected <${expected}>, got <${actual}>`)
  } else {
    console.log(`SUCCESS: Got Expected <${expected}>`)
  }
}

const driver = new BotDriver()

driver.BuildFluent()
  .Start()
  .UserSaysText('start')
  .WaitBotSaysText((text) => assert('Hi. It looks like a nice drive today. What would you like me to do?', text))
  .UserSaysText('turn on the lights please')
  .WaitBotSaysText((text) => assert('I\'ll turn on the lights for you.', text))
  .UserSaysText('play some jazz music')
  .WaitBotSaysText((text) => assert('Great choice! Playing some jazz for you.', text))
  .Stop()
  .Clean()
  .Exec()
  .then(() => {
    console.log('READY')
  })
  .catch((err) => {
    console.log('ERROR: ', err)
  })
