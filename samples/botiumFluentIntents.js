const BotDriver = require('botium-core').BotDriver

const driver = new BotDriver()
  .setCapability('WATSON_USE_INTENT', true)

driver.BuildFluent()
  .Start()
  .UserSaysText('start')
  .WaitBotSaysText(console.log)
  .UserSaysText('failed training')
  .WaitBotSays((msg) => console.log('it should have been failed for duplicate intent confidence of 1 ', msg.sourceData.intents))
  .Stop()
  .Clean()
  .Exec()
  .then(() => {
    console.log('READY')
  })
  .catch((err) => {
    console.log('ERROR: ', err)
  })
