import util from "../util"
import wx from "weixin-js-sdk-ts"
import rq from "../../request"
import images from "../../images"

let hasConfigWxJsSDK = false

const _configWxJsSDK = (): Promise<boolean> => {
  if(hasConfigWxJsSDK) return util.getPromise(true)

  const _env = util.getEnv()
  const url = _env.THIRD_PARTY_SETTING_URL
  if(!url) return util.getPromise(true)

  const body1 = {
    operateType: "WX_JS_SDK_CONFIG",
    webUrl: location.origin
  }

  console.log("body1: ")
  console.log(body1)
  console.log(" ")

  const _handle = async (a: (a1: boolean) => void): Promise<void> => {
    const res1 = await rq.request<WxConfig>(url, body1)
    let { code, data } = res1
    if(!data) {
      a(false)
      return
    }

    let jsApiList: wx.ApiMethod[] = ["updateAppMessageShareData", "updateTimelineShareData"]
    let data2 = { 
      ...data, 
      jsApiList,
      openTagList: []
    }

    console.log("去 wx.config...............")
    console.log(data2)
    console.log(" ")
    wx.config(data2)
    wx.ready(() => {
      console.log("wx.ready..............")
      hasConfigWxJsSDK = true
      a(true)
    })
    wx.error((e) => {
      console.log("wx.error...............")
      console.log(e)
      console.log(" ")
      a(false)
    })
    setTimeout(() => {
      a(false)
    }, 3000)
  }

  return new Promise(_handle)
}



const _setBasic = (title?: string, desc?: string, iconUrl?: string) => {
  if(title) {
    document.title = title
    const twitter_title = document.querySelector(`head > meta[name="twitter:title"]`)
    const og_title = document.querySelector(`head > meta[property="og:title"]`)
    twitter_title?.setAttribute("content", title)
    og_title?.setAttribute("content", title)
  }
  if(desc !== undefined) {
    const descEl = document.querySelector(`head > meta[name="description"]`)
    const twitter_desc = document.querySelector(`head > meta[name="twitter:description"]`)
    const og_desc = document.querySelector(`head > meta[property="og:description"]`)
    descEl?.setAttribute("content", desc)
    twitter_desc?.setAttribute("content", desc)
    og_desc?.setAttribute("content", desc)
  }
  if(iconUrl) {
    const iconEl = document.querySelector(`head > link[rel="icon"]`)
    const twitter_image = document.querySelector(`head > meta[name="twitter:image"]`)
    const og_image = document.querySelector(`head > meta[property="og:image"]`)
    iconEl?.setAttribute("href", iconUrl)
    twitter_image?.setAttribute("content", iconUrl)
    og_image?.setAttribute("content", iconUrl)
  }
}

const _setWeChat = (wxShare: WxShare) => {
  if(!hasConfigWxJsSDK) return
  let { 
    frdTitle, 
    frdDesc = "邀请你一起听播客",
    frdImgUrl = images.APP_LOGO_COS,
    pyqTitle,
    pyqImgUrl = images.APP_LOGO_COS,
    link = location.origin
  } = wxShare
  wx.updateAppMessageShareData({
    title: frdTitle,
    desc: frdDesc,
    imgUrl: frdImgUrl,
    link,
    success() {
      console.log("分享到微信好友.......")
    },
    cancel() {
      console.log("取消分享到微信好友.......")
    }
  })
  wx.updateTimelineShareData({
    title: pyqTitle,
    imgUrl: pyqImgUrl,
    link,
    success() {
      console.log("分享到pyq.......")
    },
    cancel() {
      console.log("取消分享到pyq.......")
    }
  })
}

const _reset = () => {
  let title = "一起听播客"
  let desc = "跟你的好友一起实时听播客！"
  let iconUrl = images.FAVI_ICON
  _setBasic(title, desc, iconUrl)
  _setWeChat({ frdTitle: title, pyqTitle: title })
}

const configShare = async (opt?: ShareCfgData): Promise<void> => {
  await _configWxJsSDK()

  // 如果没有 opt 代表 reset
  if(!opt) {
    _reset()
    return
  }
  let { title, desc, imageUrl } = opt
  _setBasic(title, desc, imageUrl)
  if(opt.wxShare) _setWeChat(opt.wxShare)
}

const onTapShare = () => {

}

export default {
  configShare,
  onTapShare
}