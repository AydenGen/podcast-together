import cloud from '@/cloud-sdk'
const db = cloud.database()

const MAX_ROOM_NUM = 15

interface RequestParam {
  "x-pt-version": string
  "x-pt-client": string
  "x-pt-stamp": number
  "x-pt-language": string
  "x-pt-local-id": string
}

interface ContentData {
  infoType: "podcast"
  audioUrl: string
  sourceType?: string
  title?: string
  description?: string
  imageUrl?: string
  linkUrl?: string
}

interface Participant {
  nickName: string
  enterStamp: number
  heartbeatStamp: number
  userAgent?: string
  guestId: string
  nonce: string
}

interface ParticipantClient {
  nickName: string
  guestId: string
  heartbeatStamp: number
  enterStamp: number
}

interface RoRes {
  roomId: string
  content: ContentData
  playStatus: "PLAYING" | "PAUSED"
  speedRate: "1"
  operator: string
  contentStamp: number
  participants: ParticipantClient[]
  guestId?: string
}

interface ResType {
  code: string
  errMsg?: string
  showMsg?: string
  data?: RoRes
}

interface Room {
  _id: string
  title?: string
  content: ContentData
  oState: "OK" | "EXPIRED" | "DELETED"
  playStatus: "PLAYING" | "PAUSED"
  speedRate: "1"
  contentStamp: number
  operateStamp: number
  operator: string
  createStamp: number
  owner: string
  participants: Participant[]
}

type OperateType = "CREATE" | "ENTER" | "HEARTBEAT" | "LEAVE"

exports.main = async function (ctx: FunctionContext): Promise<ResType> {
  let err = checkEntry(ctx)
  if(err) return err

  let res: ResType = { code: "E4044" }
  const t = ctx.body.operateType as OperateType
  const { headers } = ctx
  const ua = headers?.['user-agent']

  if(t === "CREATE") {
    res = await handle_create(ctx.body)
  }
  else if(t === "ENTER") {
    res = await handle_enter(ctx.body, ua)
  }
  else if(t === "HEARTBEAT") {
    res = await handle_heartbeat(ctx.body)
  }
  else if(t === "LEAVE") {
    res = await handle_leave(ctx.body)
  }

  return res
}

interface CommonBody extends RequestParam {
  operateType: "ENTER" | "HEARTBEAT" | "LEAVE"
  roomId: string
  nickName: string
}


/**
 * 离开房间
 */
async function handle_leave(body: CommonBody): Promise<ResType> {
  const clientId = body["x-pt-local-id"]
  const { roomId } = body

  let room = await _getRoom(roomId)
  if(!room || !room._id) return { code: "E4004" }
  let { oState, participants = [] } = room
  if(oState === "EXPIRED") return { code: "E4006" }
  if(oState === "DELETED") return { code: "E4004" }
  if(participants.length < 1) return { code: "0000" }

  let me = participants.find(v => v.nonce === clientId)
  if(!me) return { code: "E4003" }
  if(participants.length === 1) {
    room = _pausePlayer(room)
    room.participants = []
    let newRoom: Partial<Room> = { ...room }
    delete newRoom._id
    await _updateRoom(roomId, newRoom)
    return { code: "0000" }
  }

  participants = participants.filter(v => v.nonce !== clientId)
  await _updateRoom(roomId, { participants })
  return { code: "0000" }
}


/**
 * 上报心跳
 */
async function handle_heartbeat(body: CommonBody): Promise<ResType> {
  const clientId = body["x-pt-local-id"]
  const { roomId } = body

  let room = await _getRoom(roomId)
  if(!room || !room._id) return { code: "E4004" }
  let { oState, participants = [] } = room
  if(oState === "EXPIRED") return { code: "E4006" }
  if(oState === "DELETED") return { code: "E4004" }

  const now = Date.now()
  let me = participants.find(v => v.nonce === clientId)
  if(!me) return { code: "E4003" }
  me.heartbeatStamp = now
  participants = participants.map(v => {
    if(v.nonce === clientId) v = me as Participant
    return v
  })
  
  await _updateRoom(roomId, { participants })
  let pClients: ParticipantClient[] = participants.map(v => {
    let p: ParticipantClient = {
      nickName: v.nickName,
      guestId: v.guestId,
      heartbeatStamp: v.heartbeatStamp,
      enterStamp: v.enterStamp,
    }
    return p
  })
  let roRes: RoRes = {
    roomId,
    content: room.content,
    playStatus: room.playStatus,
    speedRate: room.speedRate,
    operator: room.operator,
    contentStamp: room.contentStamp,
    participants: pClients,
  }
  return { code: "0000", data: roRes }
}



/**
 * 进入房间
 */
async function handle_enter(body: CommonBody, ua?: string): Promise<ResType> {
  const clientId = body["x-pt-local-id"]
  const { roomId, nickName } = body
  
  // 查找房间
  let room = await _getRoom(roomId)
  if(!room || !room._id) return { code: "E4004" }
  let { oState, participants = [] } = room
  if(oState === "EXPIRED") return { code: "E4006" }
  if(oState === "DELETED") return { code: "E4004" }


  let guestId = ""
  const now = Date.now()
  let me = participants.find(v => v.nonce === clientId)
  if(me) {
    guestId = me.guestId
    me.nickName = nickName
    me.enterStamp = now
    me.heartbeatStamp = now
    if(ua) me.userAgent = ua
    participants = participants.map(v => {
      if(v.nonce === clientId) v = me as Participant
      return v
    })
  }
  else {
    if(participants.length >= MAX_ROOM_NUM) {
      return { code: "R0001" }
    }
    guestId = _generateGuestId(participants)
    me = {
      nickName,
      enterStamp: now,
      heartbeatStamp: now,
      userAgent: ua,
      guestId,
      nonce: clientId
    }
    participants.push(me)
  }

  // 修改房间
  await _updateRoom(roomId, { participants })
  let pClients: ParticipantClient[] = participants.map(v => {
    let p: ParticipantClient = {
      nickName: v.nickName,
      guestId: v.guestId,
      heartbeatStamp: v.heartbeatStamp,
      enterStamp: v.enterStamp,
    }
    return p
  })
  let roRes: RoRes = {
    roomId,
    content: room.content,
    playStatus: room.playStatus,
    speedRate: room.speedRate,
    operator: room.operator,
    contentStamp: room.contentStamp,
    participants: pClients,
    guestId,
  }

  return { code: "0000", data: roRes }
}


/**
 * 生成一个 guestId 共 11 位数
 */
function _generateGuestId(participants: Participant[]): string {
  const ABC = "abcdefghijkmnopqrstuvwyz123456789"
  const abcLength = ABC.length
  const _generateId = () => {
    let s = ""
    for(let i=0; i<11; i++) {
      const r1 = Math.random()
      const r2 = Math.floor(r1 * abcLength)
      s += ABC[r2]
    }
    return s
  }

  let ids: string[] = participants.map(v => v.guestId)

  let runTimes = 0
  let id = ""
  while(!id) {
    const _id = _generateId()
    if(!ids.includes(_id)) id = _id
    runTimes++
    if(runTimes > 15) break
  }
  return id
}

/**
 * 查找房间
 */
async function _getRoom(roomId: string): Promise<Room | undefined> {
  const col = db.collection("Room")
  const res = await col.doc(roomId).get()
  let room: Room | undefined = res.data
  return room
}

/**
 * 修改房间
 */
async function _updateRoom(roomId: string, data: Record<string, any>) {
  const col = db.collection("Room")
  const res = await col.doc(roomId).update(data)
  console.log("查看一下修改的结果........")
  console.log(res)
  console.log(" ")
  return res
}


interface CreateBody extends RequestParam {
  operateType: "CREATE"
  roomData: ContentData
  nickName: string
}
/**
 * 处理去创建房间的流程
 */
async function handle_create(body: CreateBody): Promise<ResType> {
  const clientId = body["x-pt-local-id"]
  const roomData = body.roomData

  // 先去查询是否已创建房间，如果是，就去删除该房间
  await _checkMyRoomAndDelete(clientId)
  
  // 创建新的房间
  let roRes = await _createRoom(clientId, roomData)
  return { code: "0000", data: roRes }
}

/**
 * 创建房间
 */
async function _createRoom(clientId: string, roomData: ContentData): Promise<RoRes> {
  const col = db.collection("Room")
  const now = Date.now()
  let room: Partial<Room> = {
    content: roomData,
    oState: "OK",
    playStatus: "PAUSED",
    speedRate: "1",
    contentStamp: 0,
    operateStamp: now,
    operator: "",
    createStamp: now,
    owner: clientId,
    participants: []
  }
  const res = await col.add(room)
  let roRes: RoRes = {
    roomId: res.id as string,
    content: roomData,
    playStatus: "PAUSED",
    speedRate: "1",
    operator: "",
    contentStamp: 0,
    participants: []
  }
  return roRes
}

/**
 * 检测是否房主是否已有房间
 */
async function _checkMyRoomAndDelete(clientId: string): Promise<boolean> {
  const col = db.collection("Room")
  const res = await col.where({
    oState: "OK",
    owner: clientId
  }).get()

  if(res.data?.length) {
    let room: Room = res.data[0]
    const roomId = room._id
    room = _pausePlayer(room)
    room.oState = "DELETED"
    room.participants = []
    let newRoom: Partial<Room> = { ...room }
    delete newRoom._id
    await _updateRoom(roomId, newRoom)
  }
  return true
}

/**
 * 
 * 检测是否已暂停，已暂停则直接返回 room
 * 
 * 调整 playStatus / contentStamp / operateStamp / operator
 * 
 *   查看房间是否有人
 *     找出最后一个心跳来
 *   查看是否
 */
function _pausePlayer(room: Room, operator: string = ""): Room {
  if(room.playStatus === "PAUSED") return room
  room.playStatus = "PAUSED"
  let participants = room.participants || []

  let { operateStamp, speedRate, contentStamp } = room
  let speedRateNum: number = Number(speedRate)

  // 如果房间里有人
  if(participants.length > 0) {
    let lastHeartbeat: number = operateStamp
    for(let i=0; i<participants.length; i++) {
      let p = participants[i]
      if(p.heartbeatStamp > lastHeartbeat) lastHeartbeat = p.heartbeatStamp
    }
    let diffStamp = lastHeartbeat - operateStamp
    room.contentStamp = contentStamp + (diffStamp * speedRateNum)
    room.operateStamp = Date.now()
    room.operator = operator
    return room
  }

  // 如果房间里没人

  return room
}


/**
 * 检测入参和请求方式 
 */
function checkEntry(ctx: FunctionContext): ResType | null {
  const { auth, body = {}, method } = ctx
  
  let errData: ResType = { code: "E4000" }
  if(method !== "POST") {
    errData.code = "E4005"
    return errData
  }

  console.log("看一下入参的 body:::")
  console.log(body)
  console.log(" ")
  const localId = body["x-pt-local-id"]
  if(!localId) return errData

  let { operateType = "", nickName, roomId } = body
  let roomData: ContentData = body.roomData
  let oTypes = ["CREATE", "ENTER", "HEARTBEAT", "LEAVE"]
  if(!nickName) return errData
  if(!oTypes.includes(operateType)) return errData

  let oTypes2 = ["ENTER", "HEARTBEAT", "LEAVE"]
  if(!roomId && oTypes2.includes(operateType)) return errData
  if(operateType === "CREATE") {
    if(!roomData) return errData
    if(roomData.infoType !== "podcast") return errData
    if(!roomData.audioUrl) {
      errData.errMsg = "roomData.audioUrl is required"
      return errData
    }
  }
  
  return null
}