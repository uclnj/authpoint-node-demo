const qs = require('qs')
const axios = require('axios')
var assert = require('assert')
const dotenv = require('dotenv')
const keypress = require('keypress')

dotenv.config()

const NOISE = true
const QUERY_WAIT_CYCLES = 6 // this is how many times we will query the API asking if the user has answered - silly really.
const APITIMER = ms => new Promise(res => setTimeout(res, ms))

class AuthpointResources {
  constructor() {
    NOISE && console.log('::AuthpointResources')
    this.resourceId = process.env.APRESOURCEID
    this.accountId = process.env.ACCOUNTID
    this.api_key = process.env.APAPIKEY
    this.base_api_url = 'https://api.usa.cloud.watchguard.com/rest/authpoint/authentication/v1/accounts'
  }
}

const TRANSACTION_HEADERS = {
  headers: {
    'Authorization': '',
    'Content-Type': 'application/json',
    'WatchGuard-API-Key': ''
  }
}

class WatchGuardAuthpoint extends AuthpointResources {

  constructor(username, origin) {
    NOISE && console.log('::WatchGuardAuthpoint')
    super()
    assert.strictEqual(typeof (username), typeof (''))
    assert.strictEqual(typeof (origin), typeof (''))
    this.username = username
    this.origin = origin
    this.bearer = null
    // refresh every fiftyfive minutes but the API expires the authentication tokens hourly, set as needed
    this.__refreshTimer = setInterval(() => { this.refreshBearerToken() }, 55 * (60 * 1000))
    this.getBearerToken()
  }

  __ready = false
  __refreshTimer = null
  __allowPush = null
  __allowAuthenticate = null
  __authHeaders = () => {
    TRANSACTION_HEADERS.headers['Authorization'] = 'Bearer ' + this.bearer
    TRANSACTION_HEADERS.headers['WatchGuard-API-Key'] = this.api_key
    return TRANSACTION_HEADERS
  }
  __OAuth = () => { return Buffer.from(`${process.env.ACCESSID_RW}:${process.env.WGCPASSWORD}`, 'utf8').toString('base64') }

  /**
   * returns {true} if the bearer token has been claimed,
   * {false} if a refresh is in progress or the token is blank
   *
   * @memberof WatchGuardAuthpoint
   */
  ready = () => { return this.__ready }

  /**
   * sets an interval timer to refresh the bearer each hour
   *
   * @date 2021-05-20
   * @memberof WatchGuardAuthpoint
   */
  async refreshBearerToken() {
    NOISE && console.log('::refreshBearerToken')
    clearInterval(this.__refreshTimer)
    await this.getBearerToken()
    this.__refreshTimer = setInterval(() => { this.refreshBearerToken() }, 55 * (60 * 1000))
  }

  /**
   * refreshes the bearer token which expires after one-hour
   *
   * @date 2021-05-20
   * @memberof WatchGuardAuthpoint
   */
  async getBearerToken() {
    await axios
      .post(
        'https://api.usa.cloud.watchguard.com/oauth/token',
        qs.stringify({ grant_type: 'client_credentials', scope: 'api-access' }),
        {
          headers: {
            Authorization: `Basic ${this.__OAuth()}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      )
      .then((res) => {
        NOISE && console.log(`::bearer ...${res.data.access_token.slice(-(15))}`)
        this.bearer = res.data.access_token
        this.__ready = true
      })
      .catch((error) => {
        throw error
      })
  }

  /**
   * gets the users authentication policy with the authentication policy JSON (userAuthPolicyResult.json)
   *
   * @date 2021-05-20
   * @returns JSON block (userAuthPolicyResult.json)
   * @memberof WatchGuardAuthpoint
   */
  async getUserAuthenticationPolicy() {
    assert.strictEqual(typeof (this.bearer), typeof (''))
    var data = JSON.stringify({
      "login": this.username,
      "originIpAddress": this.origin
    })
    return new Promise((resolve, reject) => {
      axios.post(`${this.base_api_url}/${this.accountId}/resources/${this.resourceId}/authenticationpolicy`, data, this.__authHeaders())
        .then(res => {
          this.__allowAuthenticate = res.data.isAllowedToAuthenticate
          this.__allowPush = res.data.policyResponse.push
          resolve(res.data)
        })
        .catch(error => {
          console.log(error);
          reject()
        })
    })
  }

  /**
   * sends a push notification to the end user provided they are allowed to receive push notifications
   * as checked by the user policy
   *
   * @date 2021-05-20
   * @param {*} data
   * @returns {transactionId}
   * @memberof WatchGuardAuthpoint
   */
  async sendAuthenticationPush(data) {
    NOISE && console.log('::sendAuthenticationPush')
    if (!this.__allowAuthenticate) { console.log('This user is not allowed to authenticate with authpoint.'); return }
    if (!this.__allowPush) { console.log('This user is not allowed to authenticate through push.'); return }
    assert.strictEqual(typeof (this.bearer), typeof (''))
    return new Promise((resolve, reject) => {
      axios.post(`${this.base_api_url}/${this.accountId}/resources/${this.resourceId}/transactions`, data, this.__authHeaders())
        .then(res => {
          NOISE && console.log(`::sendAuthenticationPush - ${res.data.transactionId}`)
          resolve(res.data.transactionId)
        })
        .catch(error => {
          console.log(error);
          reject()
        })
    })
  }

  /**
   * polling mechinism to query API to see if the user has responded yet
   *
   * @date 2021-05-20
   * @param {*} transactionId
   * @returns
   * @memberof WatchGuardAuthpoint
   */
  async requestTransactionIDResult(transactionId) {
    assert.strictEqual(typeof (arguments[0]), typeof (''))
    assert.strictEqual(typeof (this.bearer), typeof (''))
    try {
      const res = await axios.get(`${this.base_api_url}/${this.accountId}/resources/${this.resourceId}/transactions/${transactionId}`, this.__authHeaders())
      return res.data
    } catch (err) {
      if (err.response.status == 403) {
        return {
          pushResult: 'DENIED'
        }
      }
    }
  }
}

const args = process.argv.slice(2) ?? null

if (!args[0] || !args[1]) { console.log('username origin required'); process.exit() }

let __wg = new WatchGuardAuthpoint(args[0], args[1])

keypress(process.stdin)

process.stdin.on('keypress', async function (ch, key) {
  if (key.name == 'f1') { process.exit() }
  if (key.name == 'f2') {
    if (__wg.ready()) {
      var data = JSON.stringify({
        'login': args[0],
        'type': 'PUSH', 'originIpAddress': args[1],
        'clientInfoRequest': { 'machineName': '', 'osVersion': '', 'domain': '' }
      })
      //# get the users policy to see if they are allowed to auth/push
      await __wg.getUserAuthenticationPolicy()
        .then(async res => {
          NOISE && console.log(`${args[0]} ${res.hasPolicy ? 'has' : 'does not have'} an MF policy and ${res.isAllowedToAuthenticate ? 'is' : 'is not'} allowed to authenticate.`)
        }).catch(error => {
          throw 'Failed to get users auth policy.'
        })
      // push it baby
      await __wg.sendAuthenticationPush(data)
        .then(async transactionId => {
          NOISE && console.log('transaction pushed, awaiting users response...')
          // within the first 1000ms, the WG API will return a series of useless status flags so I added an intentional
          // delay of 1.5 seconds before I begin polling the sytem
          await APITIMER(1500)
          let iterations = 0, res
          while (iterations++ < QUERY_WAIT_CYCLES) {
            res = await __wg.requestTransactionIDResult(transactionId)
            if (res?.status == 202 && res?.title.includes('processing')) console.log(res.title) // can remove these - just for affect
            if (res?.status == 202 && res?.title.includes('device')) console.log(res.title) // can remove these - just for affect
            // the user authorized - notice the WG API uses actual text, not status codes to reflect the action
            if (res?.pushResult == 'AUTHORIZED') { console.log('User Authorized Push'); break; }
            // the user denied the transaction - the DENIED comes from the method, NOT the WG API
            if (res?.pushResult == 'DENIED') { console.log('User Denied Push'); break; }
            // literally, do nothing while waiting for the user
            if (iterations < 4) await APITIMER(3500)
          }
          NOISE && console.log('no longer checking, I hope you got a good result..')
        })
        .catch(error => { throw error })
    }
    else {
      console.log('ready is reporting no, wait for a bearer refresh or give up hope.')
    }
  }
})

console.log('Press F2 to send an authpoint authentication push notification')
console.log('Press F1 to terminate')
process.stdin.setRawMode(true)
process.stdin.resume()

