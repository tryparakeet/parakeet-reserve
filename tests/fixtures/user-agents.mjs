// User agents shared by the unit and e2e tests. BOT_UAS must be flagged as bots by the function's rule
// (BOT_UA, or the "Instagram <digit>" label of Meta's link checkers); REAL_UAS are browsers real visitors
// arrive with and must never be flagged. Both are objects name -> ua string.

export const BOT_UAS = {
  facebookexternalhit: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  facebot: 'facebookexternalhit/1.1 Facebot Twitterbot/1.0',
  meta_external: 'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
  bytespider: 'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)',
  tiktokspider: 'Mozilla/5.0 (compatible; TikTokSpider; ttspider-feedback@tiktok.com)',
  googlebot: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.112 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  adsbot: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1 (compatible; AdsBot-Google-Mobile; +http://www.google.com/mobile/adsbot.html)',
  headless_chrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/125.0.6422.141 Safari/537.36',
  phantomjs: 'Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML, like Gecko) PhantomJS/2.1.1 Safari/538.1',
  lighthouse: 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
  // TikTok's link checker carries a misspelt Android build token
  bulid: 'Mozilla/5.0 (Linux; Android 10; K Bulid/QP1A.190711.020; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/83.0.4103.106 Mobile Safari/537.36',
  // Meta's link checkers send the Instagram app's network label instead of a browser user agent
  instagram_label: 'Instagram 320.0.0.42.101 Android (33/13; 420dpi; 1080x2340; samsung; SM-S911B; dm1q; qcom; en_US; 561734432)'
};

export const REAL_UAS = {
  tiktok_ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.0.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US ByteFullLocale/en isDarkMode/0 WKWebView/1 BytedanceWebview/d8a21c6 FalconTag/1A2B3C4D',
  tiktok_android: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240105.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.179 Mobile Safari/537.36 trill_2024505030 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/trill app_version/35.5.3 ByteLocale/en ByteFullLocale/en Region/US AppId/1180 Spark/1.5.0.1 AppVersion/35.5.3 BytedanceWebview/d8a21c6',
  safari_ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chrome_android: 'Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36',
  instagram_ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.0.28.90 (iPhone15,2; iOS 17_5_1; en_US; en; scale=3.00; 1179x2556; 613753409)',
  facebook_ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/467.0.0.37.108;FBBV/605130014;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5;FBRV/0]'
};

// The user agent of the e2e browser context (an iPhone in Safari).
export const DEFAULT_MOBILE_UA = REAL_UAS.safari_ios;
