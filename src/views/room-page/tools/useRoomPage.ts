import { ref, reactive, onActivated, onDeactivated, nextTick } from "vue"
import { PageData, PageState, WsMsgRes, RoomStatus, PlayStatus, RevokeType } from "../../../type/type-room-page"
import { ContentData, RoRes } from "../../../type"
import { RouteLocationNormalizedLoaded } from "vue-router"
import { useRouteAndPtRouter, PtRouter, goHome } from "../../../routes/pt-router"
import ptUtil from "../../../utils/pt-util"
import api from "../../../request/api"
import rq from "../../../request"
import Shikwasa from "shikwasa2"
import util from "../../../utils/util"
import time from "../../../utils/time"
import playerTool from "./player-tool"
import { showParticipants } from "./show-participants"
import cui from "../../../components/custom-ui"
import images from "../../../images"
import ptApi from "../../../utils/pt-api"

// 一些常量
const COLLECT_TIMEOUT = 300    // 收集最新状态的最小间隔
const MAX_HB_NUM = 960    // 心跳最多轮询次数；如果每 15s 一次，相当于 4hr

// 播放器
let player: any;
const playerEl = ref<HTMLElement | null>(null)
let playStatus: PlayStatus = "PAUSED"    // 播放状态

// 路由
let router: PtRouter
let route: RouteLocationNormalizedLoaded

// web socket
let ws: WebSocket | null = null

// 绑定到页面的数据
const pageData: PageData = reactive({
  state: 1,
  roomId: "",
  participants: []
})

// 其他杂七杂八的数据
let nickName: string = ""
let localId: string = ""
let guestId: string = ""
let intervalHb: number = 0      // 维持心跳的 interval 的返回值
let timeoutCollect: number = 0  // 上报最新播放状态的 timeout 的返回值
let srcDuration: number = 0     // 资源总时长（秒），如果为 0 代表还没解析出来
let waitPlayer: Promise<boolean>
let isIniting: boolean = true   // 从 enterRoom 到第一次 receiveNewStatus 的过程；可能需要删掉！！！
let latestStatus: RoomStatus    // 最新的播放器状态
let isShowingAutoPlayPolicy: boolean = false  // 当前是否已在展示 autoplay policy 的弹窗
let heartbeatNum = 0

// 是否为远端调整播放器状态，如果是，则在监听 player 各回调时不往下执行
let isRemoteSetSeek = false
let isRemoteSetPlaying = false
let isRemoteSetPaused = false
let isRemoteSetSpeedRate = false

// 播放器准备好的回调
type SimpleFunc = (param1: boolean) => void
let playerAlready: SimpleFunc


const toHome = () => {
  goHome(router)
}

export const useRoomPage = () => {
  const rr = useRouteAndPtRouter()
  router = rr.router
  route = rr.route
  
  init()

  return { pageData, playerEl, route, router, toHome }
}

// 初始化一些东西，比如 onActivated / onDeactivated 
function init() {
  onActivated(() => {
    enterRoom()
  })

  onDeactivated(() => {
    leaveRoom()
  })
}


// 进入房间
export async function enterRoom() {
  let roomId: string = route.params.roomId as string
  pageData.roomId = roomId
  pageData.state = 1
  isIniting = true
  heartbeatNum = 0

  let userData = ptUtil.getUserData()
  nickName = userData.nickName as string
  localId = userData.nonce as string
  
  let param = {
    operateType: "ENTER",
    roomId,
    nickName,
  }
  const url = api.ROOM_OPERATE
  let res = await rq.request<RoRes>(url, param)
  if(!res) {
    pageData.state = 13
    return
  }

  let { code, data } = res
  if(code === "0000") {
    pageData.state = 2
    await nextTick()
    afterEnter(data as RoRes)
  }
  else if(code === "E4004") {
    pageData.state = 12
  }
  else if(code === "E4006") {
    pageData.state = 11
  }
  else if(code === "E4003") {
    pageData.state = 14
  }
  else if(code === "R0001") {
    pageData.state = 15
  }
  else {
    pageData.state = 20
  }
}

// 成功进入房间后: 
//    赋值 / 创建播放器 / 开启 20s 轮询机制 / 建立 webSocket
function afterEnter(roRes: RoRes) {
  pageData.content = roRes.content
  pageData.participants = showParticipants(roRes.participants)
  guestId = roRes?.guestId as string

  createPlayer()
  heartbeat()
  connectWebSocket()
}

// 创建播放器
function createPlayer() {
  let content = pageData.content as ContentData

  waitPlayer = new Promise((a: SimpleFunc) => {
    playerAlready = a
  })

  const audio = {
    src: content.audioUrl,
    title: content.title,
    cover: content.imageUrl ?? images.APP_IOGO,
    artist: content.seriesName,
  }

  console.log("去创建 player.....................")

  player = new Shikwasa({
    container: () => playerEl.value,
    audio,
    themeColor: "var(--text-color)",
    speedOptions: playerTool.initSpeedOptions(),
  })

  console.log("创建结果...................")
  console.log(player)
  console.log(" ")

  player.on("audioupdate", (e: Event) => {
    console.log("player audioupdate.............")
    console.log(e)
    console.log(" ")
  })

  player.on("audioparse", (e: Event) => {
    console.log("player audioparse.............")
    console.log(e)
    console.log(" ")
  })


  // 去监听 播放器的各个事件回调
  player.on("abort", (e: Event) => {
    console.log("player abort.............")
    console.log(e)
    console.log(" ")
  })

  player.on("complete", (e: Event) => {
    console.log("player complete.............")
    console.log(e)
    console.log(" ")
  })

  player.on("durationchange", (e: any) => {

    console.log("player durationchange................")
    console.log("e:")
    console.log(e)
    let myAudio = e?.path?.[0]
    if(!myAudio) {
      myAudio = e?.srcElement
    }
    let duration = myAudio?.duration

    console.log("看一下时长: ", duration)
    console.log(" ")
    
    if(duration) {
      srcDuration = duration
    }
  })

  player.on("emptied", (e: Event) => {
    console.log("player emptied.............")
    console.log(e)
    console.log(" ")
  })

  player.on("ended", (e: Event) => {
    console.log("player ended.............")
    console.log(e)
    console.log(" ")
  })

  player.on("error", (e: Event) => {
    console.log("player error.............")
    console.log(e)
    console.log(" ")
  })

  player.on("canplay", (e: Event) => {
    if(!playerTool.checkThrottle("canplay")) return
    if(pageData.state <= 2) {
      pageData.state = 3
      playerAlready(true)
    }
  })

  player.on("loadeddata", (e: Event) => {
    console.log("player loadeddata.............")
    console.log(e)
    console.log(" ")
    if(pageData.state <= 2) {
      pageData.state = 3
      playerAlready(true)
    }

  })

  player.on("pause", (e: Event) => {
    if(!playerTool.checkThrottle("pause")) return
    
    console.log("player pause.............")
    console.log(e)
    console.log(" ")
    
    playStatus = "PAUSED"
    if(isRemoteSetPaused) {
      isRemoteSetPaused = false
      return
    }

    collectLatestStauts()
  })

  player.on("playing", (e: Event) => {
    if(!playerTool.checkThrottle("play")) return

    playStatus = "PLAYING"
    if(isRemoteSetPlaying) {
      isRemoteSetPlaying = false
      return
    }

    collectLatestStauts()
  })

  player.on("ratechange", (e: Event) => {
    if(!playerTool.checkThrottle("speed")) return
    if(isRemoteSetSpeedRate) {
      isRemoteSetSpeedRate = false
      return
    }
    collectLatestStauts()
  })

  player.on("seeking", (e: Event) => {
    console.log("seeking..................")
    console.log(e)
    console.log(" ")
  })

  player.on("seeked", (e: Event) => {
    if(!playerTool.checkThrottle("seek")) return

    console.log("seeked..................")
    console.log(e)
    console.log(" ")

    if(isRemoteSetSeek) {
      isRemoteSetSeek = false
      return
    }
    
    collectLatestStauts()
  })

  player.on("waiting", (e: Event) => {
    console.log("player waiting.............")
    console.log(e)
    console.log(" ")
  })

  checkPlayerReady()
}

// 开始检测 player 是否已经 ready
async function checkPlayerReady() {
  const cha = ptApi.getCharacteristic()
  if(!cha.isIOS && !cha.isIPadOS) return
  let res1 = await cui.showModal({
    title: "即将进入房间",
    content: "当前房间内可能正在播放中，是否进入？",
    cancelText: "离开",
    confirmText: "进入",
  })
  if(res1.cancel) {
    toHome()
    return
  }
  player.preloadForIOS()
}


// 收集最新状态，再用 ws 上报
function collectLatestStauts() {
  if(timeoutCollect) clearTimeout(timeoutCollect)

  const _collect = () => {
    if(!player) return
    const currentTime = player.currentTime ?? 0
    let contentStamp = currentTime * 1000
    contentStamp = util.numToFix(contentStamp, 0)
    const param = {
      operateType: "SET_PLAYER",
      roomId: pageData.roomId,
      "x-pt-local-id": localId,
      "x-pt-stamp": time.getTime(),
      playStatus,
      speedRate: String(player.playbackRate),
      contentStamp,
    }

    // console.log("看一下使用 ws 的上报数据: ")
    // console.log(param)
    // console.log(" ")
    const msg = JSON.stringify(param)
    ws?.send(msg)
  }

  timeoutCollect = setTimeout(() => {
    _collect()
  }, COLLECT_TIMEOUT)
}

// 每若干秒的心跳
function heartbeat() {
  const _env = util.getEnv()

  const _closeRoom = (val: PageState) => {
    pageData.state = val
    // 销毁心跳
    if(intervalHb) clearInterval(intervalHb)
    intervalHb = 0

    // 关闭 web-socket
    if(ws) {
      ws.close()
    }

    // 销毁播放器
    if(player) {
      player.destroy()
      player = null
    }
  }

  const _newRoomStatus = (roRes: RoRes) => {
    pageData.content = roRes.content
    pageData.participants = showParticipants(roRes.participants)
    latestStatus = {
      roomId: roRes.roomId,
      playStatus: roRes.playStatus,
      speedRate: roRes.speedRate,
      operator: roRes.operator,
      contentStamp: roRes.contentStamp,
      operateStamp: roRes.operateStamp
    }
    receiveNewStatus("http")
  }

  const _webSocketHb = () => {
    const send = {
      operateType: "FIRST_SEND",
      roomId: pageData.roomId,
      "x-pt-local-id": localId,
      "x-pt-stamp": time.getTime()
    }
    const msg = JSON.stringify(send)
    ws?.send(msg)
  }

  intervalHb = setInterval(async () => {
    heartbeatNum++
    if(heartbeatNum > MAX_HB_NUM) {
      _closeRoom(16)
      return
    }

    const param = {
      operateType: "HEARTBEAT",
      roomId: pageData.roomId,
      nickName,
    }
    const url = api.ROOM_OPERATE
    const res = await rq.request<RoRes>(url, param)
    if(!res) return
    const { code, data } = res
    if(code === "0000") {
      _newRoomStatus(data as RoRes)
      _webSocketHb()
    }
    else if(code === "E4004") {
      _closeRoom(12)
    }
    else if(code === "E4006") {
      _closeRoom(11)
    }
    else if(code === "E4003") {
      _closeRoom(14)
    }

  }, _env.HEARTBEAT_PERIOD * 1000)
}

// 使用 web-socket 去建立连接
function connectWebSocket() {
  const _env = util.getEnv()
  const { WEBSOCKET_URL } = _env
  ws = new WebSocket(WEBSOCKET_URL)

  ws.onopen = (socket: Event) => {
    console.log("ws opened.........")
    console.log(socket)
    console.log(" ")
  }

  ws.onmessage = (res) => {
    const message = res.data
    const msgRes = util.strToObj<WsMsgRes>(message)
    

    if(!msgRes) return
    const { responseType: rT, roomStatus } = msgRes

    // 刚连接
    if(rT === "CONNECTED") {
      firstSend()
    }
    else if(rT === "NEW_STATUS" && roomStatus) {
      console.log("web-socket 收到新的的状态.......")
      console.log(msgRes)
      console.log(" ")
      latestStatus = roomStatus
      receiveNewStatus()
    }
  }
}

// "首次发送" 给 websocket
function firstSend() {
  const send = {
    operateType: "FIRST_SEND",
    roomId: pageData.roomId,
    "x-pt-local-id": localId,
    "x-pt-stamp": time.getTime()
  }

  const msg = JSON.stringify(send)
  ws?.send(msg)
}

async function receiveNewStatus(fromType: RevokeType = "ws") {
  if(latestStatus.roomId !== pageData.roomId) return
  if(isIniting) {
    isIniting = false
  }

  await waitPlayer
  let { contentStamp, operator } = latestStatus

  // 判断时间
  let reSeekSec = playerTool.getReSeek(latestStatus, srcDuration, player.currentTime, fromType)
  if(reSeekSec >= 0) {
    isRemoteSetSeek = true
    player.seek(reSeekSec)
    checkSeek()
  }

  // 判断倍速
  let rSpeedRate = latestStatus.speedRate
  let speedRate = String(player.playbackRate)

  if(rSpeedRate !== speedRate) {
    console.log("播放器倍速不一致，请求调整......")
    isRemoteSetSpeedRate = true
    let speedRateNum = Number(rSpeedRate)
    player.playbackRate = speedRateNum
  }

  // 判断播放状态
  let rPlayStatus = latestStatus.playStatus
  let diff2 = (srcDuration * 1000) - contentStamp
  if(rPlayStatus !== playStatus) {
    // 如果剩下 1s 就结束了 还要播放，进行阻挡
    if(rPlayStatus === "PLAYING" && diff2 < 1000) return
    if(rPlayStatus === "PLAYING" && !isShowingAutoPlayPolicy) {
      console.log("远端请求播放......")
      isRemoteSetPlaying = true
      try {
        player.play()
      }
      catch(err) {
        console.log("播放失败.....")
        console.log(err)
      }
      checkIsPlaying()
    }
    else if(rPlayStatus === "PAUSED") {
      console.log("远端请求暂停......")
      isRemoteSetPaused = true
      player.pause()
    }
  }
}

// 由于 iOS 初始化时设置时间点 会不起作用
// 所以重新做检查
async function checkSeek() {
  await util.waitMilli(600)
  console.log("checkSeek................")
  let reSeekSec = playerTool.getReSeek(latestStatus, srcDuration, player.currentTime, "check")
  if(reSeekSec >= 0) {
    isRemoteSetSeek = true
    player.seek(reSeekSec)
  }
}

async function checkIsPlaying() {
  await util.waitMilli(1500)
  const rPlayStatus = latestStatus.playStatus
  if(rPlayStatus === "PLAYING" && playStatus === "PAUSED") {
    handleAutoPlayPolicy()
  }
}

async function handleAutoPlayPolicy() {
  if(isShowingAutoPlayPolicy) return

  isShowingAutoPlayPolicy = true
  let res1 = await cui.showModal({
    title: "当前房间正在播放",
    content: "🔇还是🔊？",
    cancelText: "静音",
    confirmText: "开声音"
  })
  isShowingAutoPlayPolicy = false

  // 如果是静音
  if(res1.cancel) {
    player.muted = true
  }

  // 调整进度条
  let reSeekSec = playerTool.getReSeek(latestStatus, srcDuration, player.currentTime, "check")
  if(reSeekSec >= 0) {
    isRemoteSetSeek = true
    player.seek(reSeekSec)
  }

  // 开始播放
  if(latestStatus.playStatus === "PLAYING") {
    isRemoteSetPlaying = true
    player.play()
  }
}


// 离开房间
async function leaveRoom() {

  // 销毁心跳
  if(intervalHb) clearInterval(intervalHb)
  intervalHb = 0

  // 关闭 web-socket
  if(ws) {
    ws.close()
  }

  // 销毁播放器
  if(player) {
    player.destroy()
    player = null
  }

  // 去发送离开房间的请求
  let param = {
    operateType: "LEAVE",
    roomId: pageData.roomId,
    nickName,
  }
  const url = api.ROOM_OPERATE
  const res = await rq.request<RoRes>(url, param)
  console.log("看一下离开的结果......")
  console.log(res)
  console.log(" ")
}
