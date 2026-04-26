/**
 * 全国机场/城市数据
 * code: 携程城市代码（用于 API 查询）
 * city: 城市中文名
 * pinyin: 城市拼音（用于搜索和排序）
 * airports: 机场名称（供参考）
 */
const AIRPORTS = [
  { code: "AAT", city: "阿勒泰", pinyin: "aleitai", airports: "阿勒泰雪都" },
  { code: "AKA", city: "安康", pinyin: "ankang", airports: "安康富强" },
  { code: "AQG", city: "安庆", pinyin: "anqing", airports: "安庆天柱山" },
  { code: "AOG", city: "鞍山", pinyin: "anshan", airports: "鞍山腾鳌" },
  { code: "AVA", city: "安顺", pinyin: "anshun", airports: "安顺黄果树" },
  { code: "BSD", city: "保山", pinyin: "baoshan", airports: "保山云瑞" },
  { code: "PAV", city: "白山", pinyin: "baishan", airports: "长白山" },
  { code: "BHY", city: "北海", pinyin: "beihai", airports: "北海福成" },
  { code: "BJS", city: "北京", pinyin: "beijing", airports: "首都/大兴" },
  { code: "BPX", city: "日喀则", pinyin: "rikaze", airports: "日喀则和平" },
  { code: "CGQ", city: "长春", pinyin: "changchun", airports: "龙嘉" },
  { code: "CGO", city: "郑州", pinyin: "zhengzhou", airports: "新郑" },
  { code: "CSX", city: "长沙", pinyin: "changsha", airports: "黄花" },
  { code: "CTX", city: "赤峰", pinyin: "chifeng", airports: "赤峰玉龙" },
  { code: "CHW", city: "朝阳", pinyin: "chaoyang", airports: "朝阳" },
  { code: "CIF", city: "赤峰", pinyin: "chifeng2", airports: "玉龙" },
  { code: "CZX", city: "常州", pinyin: "changzhou", airports: "奔牛" },
  { code: "CKG", city: "重庆", pinyin: "chongqing", airports: "江北/仙女山" },
  { code: "DAX", city: "达州", pinyin: "dazhou", airports: "河市" },
  { code: "DLC", city: "大连", pinyin: "dalian", airports: "周水子" },
  { code: "DLU", city: "大理", pinyin: "dali", airports: "荒草坝" },
  { code: "DAT", city: "大同", pinyin: "datong", airports: "云冈" },
  { code: "DDG", city: "丹东", pinyin: "dandong", airports: "浪头" },
  { code: "DIG", city: "德宏", pinyin: "dehong", airports: "芒市" },
  { code: "DOY", city: "东营", pinyin: "dongying", airports: "胜利" },
  { code: "DNH", city: "敦煌", pinyin: "dunhuang", airports: "莫高" },
  { code: "ENH", city: "恩施", pinyin: "enshi", airports: "许家坪" },
  { code: "FUG", city: "阜阳", pinyin: "fuyang", airports: "西关" },
  { code: "FOC", city: "福州", pinyin: "fuzhou", airports: "长乐" },
  { code: "KOW", city: "赣州", pinyin: "ganzhou", airports: "黄金" },
  { code: "GOQ", city: "格尔木", pinyin: "geermu", airports: "格尔木" },
  { code: "GHN", city: "广汉", pinyin: "guanghan", airports: "广汉" },
  { code: "CAN", city: "广州", pinyin: "guangzhou", airports: "白云" },
  { code: "GYS", city: "广元", pinyin: "guangyuan", airports: "盘龙" },
  { code: "KWL", city: "桂林", pinyin: "guilin", airports: "两江" },
  { code: "KWE", city: "贵阳", pinyin: "guiyang", airports: "龙洞堡" },
  { code: "HAK", city: "海口", pinyin: "haikou", airports: "美兰" },
  { code: "HLD", city: "海拉尔", pinyin: "hailaer", airports: "东山" },
  { code: "HMI", city: "哈密", pinyin: "hami", airports: "哈密" },
  { code: "HRB", city: "哈尔滨", pinyin: "haerbin", airports: "太平" },
  { code: "HGH", city: "杭州", pinyin: "hangzhou", airports: "萧山" },
  { code: "HZG", city: "汉中", pinyin: "hanzhong", airports: "城固" },
  { code: "HEK", city: "黑河", pinyin: "heihe", airports: "瑷珲" },
  { code: "HET", city: "呼和浩特", pinyin: "huhehaote", airports: "白塔" },
  { code: "HFE", city: "合肥", pinyin: "hefei", airports: "新桥" },
  { code: "HEE", city: "邢台", pinyin: "xingtai", airports: "褡裢" },
  { code: "HKM", city: "且末", pinyin: "qiemo", airports: "且末" },
  { code: "HKG", city: "香港", pinyin: "xianggang", airports: "赤鱲角" },
  { code: "TXN", city: "黄山", pinyin: "huangshan", airports: "屯溪" },
  { code: "HUZ", city: "惠州", pinyin: "huizhou", airports: "平潭" },
  { code: "HTN", city: "和田", pinyin: "hetian", airports: "和田" },
  { code: "JMU", city: "佳木斯", pinyin: "jiamusi", airports: "东郊" },
  { code: "JGN", city: "嘉峪关", pinyin: "jiayuguan", airports: "嘉峪关" },
  { code: "JIL", city: "吉林", pinyin: "jilin", airports: "二台子" },
  { code: "JNG", city: "济宁", pinyin: "jining", airports: "曲阜" },
  { code: "JNZ", city: "锦州", pinyin: "jinzhou", airports: "小岭子" },
  { code: "JZH", city: "九寨沟", pinyin: "jiuzhaigou", airports: "黄龙" },
  { code: "JIQ", city: "黔江", pinyin: "qianjiang", airports: "武陵山" },
  { code: "JGS", city: "井冈山", pinyin: "jinggangshan", airports: "井冈山" },
  { code: "JHG", city: "西双版纳", pinyin: "xishuangbanna", airports: "嘎洒" },
  { code: "JJN", city: "晋江", pinyin: "jinjiang", airports: "泉州晋江" },
  { code: "KNH", city: "金门", pinyin: "jinmen", airports: "尚义" },
  { code: "KJI", city: "喀纳斯", pinyin: "kanasi", airports: "喀纳斯" },
  { code: "KHG", city: "喀什", pinyin: "kashi", airports: "喀什" },
  { code: "KRL", city: "库尔勒", pinyin: "kuerle", airports: "库尔勒" },
  { code: "KMG", city: "昆明", pinyin: "kunming", airports: "长水" },
  { code: "LHW", city: "兰州", pinyin: "lanzhou", airports: "中川" },
  { code: "LXA", city: "拉萨", pinyin: "lasa", airports: "贡嘎" },
  { code: "LJG", city: "丽江", pinyin: "lijiang", airports: "三义" },
  { code: "LNJ", city: "临沧", pinyin: "lincang", airports: "博尚" },
  { code: "LYA", city: "洛阳", pinyin: "luoyang", airports: "北郊" },
  { code: "LYI", city: "临沂", pinyin: "linyi", airports: "沭埠岭" },
  { code: "LDS", city: "伊春", pinyin: "yichun", airports: "林都" },
  { code: "LCX", city: "连城", pinyin: "liancheng", airports: "冠豸山" },
  { code: "LUM", city: "芒市", pinyin: "mangshi", airports: "德宏" },
  { code: "MFM", city: "澳门", pinyin: "aomen", airports: "澳门" },
  { code: "MXZ", city: "梅州", pinyin: "meizhou", airports: "梅县" },
  { code: "MIG", city: "绵阳", pinyin: "mianyang", airports: "南郊" },
  { code: "OHE", city: "漠河", pinyin: "mohe", airports: "古莲" },
  { code: "MDG", city: "牡丹江", pinyin: "mudanjiang", airports: "海浪" },
  { code: "NAY", city: "南阳", pinyin: "nanyang", airports: "姜营" },
  { code: "NGB", city: "宁波", pinyin: "ningbo", airports: "栎社" },
  { code: "NKG", city: "南京", pinyin: "nanjing", airports: "禄口" },
  { code: "NNG", city: "南宁", pinyin: "nanning", airports: "吴圩" },
  { code: "NTG", city: "南通", pinyin: "nantong", airports: "兴东" },
  { code: "NAO", city: "南充", pinyin: "nanchong", airports: "高坪" },
  { code: "NNY", city: "南阳", pinyin: "nanyang2", airports: "姜营" },
  { code: "PZI", city: "攀枝花", pinyin: "panzhihua", airports: "保安营" },
  { code: "SYM", city: "普洱", pinyin: "puer", airports: "思茅" },
  { code: "IQM", city: "且末", pinyin: "qiemo2", airports: "且末" },
  { code: "NDG", city: "齐齐哈尔", pinyin: "qiqihaer", airports: "三家子" },
  { code: "SHP", city: "秦皇岛", pinyin: "qinhuangdao", airports: "北戴河" },
  { code: "TAO", city: "青岛", pinyin: "qingdao", airports: "胶东" },
  { code: "QSH", city: "黔江", pinyin: "qianjiang2", airports: "武陵山" },
  { code: "JUZ", city: "衢州", pinyin: "quzhou", airports: "衢州" },
  { code: "RKZ", city: "日喀则", pinyin: "rikaze2", airports: "和平" },
  { code: "RIZ", city: "日照", pinyin: "rizhao", airports: "山字河" },
  { code: "SQJ", city: "三明", pinyin: "sanming", airports: "沙县" },
  { code: "SYX", city: "三亚", pinyin: "sanya", airports: "凤凰" },
  { code: "SHA", city: "上海", pinyin: "shanghai", airports: "虹桥/浦东" },
  { code: "SZX", city: "深圳", pinyin: "shenzhen", airports: "宝安" },
  { code: "SHE", city: "沈阳", pinyin: "shenyang", airports: "桃仙" },
  { code: "SWA", city: "揭阳", pinyin: "jieyang", airports: "潮汕" },
  { code: "SHS", city: "沙市", pinyin: "shashi", airports: "沙市" },
  { code: "SHL", city: "石家庄", pinyin: "shijiazhuang", airports: "正定" },
  { code: "SCG", city: "石河子", pinyin: "shihezi", airports: "石河子" },
  { code: "SJW", city: "石家庄", pinyin: "shijiazhuang2", airports: "正定" },
  { code: "WDS", city: "神农架", pinyin: "shennongjia", airports: "红坪" },
  { code: "HSN", city: "舟山", pinyin: "zhoushan", airports: "普陀山" },
  { code: "TYN", city: "太原", pinyin: "taiyuan", airports: "武宿" },
  { code: "TCG", city: "塔城", pinyin: "tacheng", airports: "塔城" },
  { code: "TCZ", city: "腾冲", pinyin: "tengchong", airports: "驼峰" },
  { code: "TSN", city: "天津", pinyin: "tianjin", airports: "滨海" },
  { code: "TNH", city: "通化", pinyin: "tonghua", airports: "三源浦" },
  { code: "TGO", city: "通辽", pinyin: "tongliao", airports: "通辽" },
  { code: "TNA", city: "济南", pinyin: "jinan", airports: "遥墙" },
  { code: "TYR", city: "铜仁", pinyin: "tongren", airports: "凤凰" },
  { code: "TPE", city: "台北", pinyin: "taibei", airports: "桃园/松山" },
  { code: "WXN", city: "万州", pinyin: "wanzhou", airports: "五桥" },
  { code: "WEF", city: "潍坊", pinyin: "weifang", airports: "南苑" },
  { code: "WEH", city: "威海", pinyin: "weihai", airports: "大水泊" },
  { code: "WNH", city: "文山", pinyin: "wenshan", airports: "普者黑" },
  { code: "WNZ", city: "温州", pinyin: "wenzhou", airports: "龙湾" },
  { code: "WUA", city: "乌海", pinyin: "wuhai", airports: "乌海" },
  { code: "WUH", city: "武汉", pinyin: "wuhan", airports: "天河" },
  { code: "HAK", city: "海口", pinyin: "haikou2", airports: "美兰" },
  { code: "WUS", city: "武夷山", pinyin: "wuyishan", airports: "武夷山" },
  { code: "WUZ", city: "梧州", pinyin: "wuzhou", airports: "长洲岛" },
  { code: "URC", city: "乌鲁木齐", pinyin: "wulumuqi", airports: "地窝堡" },
  { code: "XAT", city: "阿克苏", pinyin: "akesu", airports: "温宿" },
  { code: "XIY", city: "西安", pinyin: "xian", airports: "咸阳" },
  { code: "XIC", city: "西昌", pinyin: "xichang", airports: "青山" },
  { code: "XIL", city: "锡林浩特", pinyin: "xilinhaote", airports: "锡林浩特" },
  { code: "XNN", city: "西宁", pinyin: "xining", airports: "曹家堡" },
  { code: "XUZ", city: "徐州", pinyin: "xuzhou", airports: "观音" },
  { code: "XFN", city: "襄阳", pinyin: "xiangyang", airports: "刘集" },
  { code: "XEN", city: "兴宁", pinyin: "xingning", airports: "兴宁" },
  { code: "ACX", city: "兴义", pinyin: "xingyi", airports: "兴义" },
  { code: "YBP", city: "宜宾", pinyin: "yibin", airports: "菜坝" },
  { code: "YIH", city: "宜昌", pinyin: "yichang", airports: "三峡" },
  { code: "YIN", city: "伊宁", pinyin: "yining", airports: "伊宁" },
  { code: "YIW", city: "义乌", pinyin: "yiwu", airports: "义乌" },
  { code: "YNJ", city: "延吉", pinyin: "yanji", airports: "朝阳川" },
  { code: "YNT", city: "烟台", pinyin: "yantai", airports: "蓬莱" },
  { code: "YNZ", city: "盐城", pinyin: "yancheng", airports: "南洋" },
  { code: "YUA", city: "元谋", pinyin: "yuanmou", airports: "元谋" },
  { code: "UYN", city: "榆林", pinyin: "yulin", airports: "榆阳" },
  { code: "YUS", city: "玉树", pinyin: "yushu", airports: "巴塘" },
  { code: "YZY", city: "张掖", pinyin: "zhangye", airports: "甘州" },
  { code: "ZHA", city: "湛江", pinyin: "zhanjiang", airports: "吴川" },
  { code: "ZAT", city: "昭通", pinyin: "zhaotong", airports: "昭通" },
  { code: "HJJ", city: "芷江", pinyin: "zhijiang", airports: "怀化芷江" },
  { code: "CGD", city: "常德", pinyin: "changde", airports: "桃花源" },
  { code: "ZQZ", city: "张家口", pinyin: "zhangjiakou", airports: "宁远" },
  { code: "ZYI", city: "遵义", pinyin: "zunyi", airports: "新舟/茅台" },
  { code: "ZUH", city: "珠海", pinyin: "zhuhai", airports: "金湾" },
  { code: "HSZ", city: "衡山", pinyin: "hengshan", airports: "衡山" },
  { code: "LYG", city: "连云港", pinyin: "lianyungang", airports: "花果山" },
  { code: "HNY", city: "衡阳", pinyin: "hengyang", airports: "南岳" },
  { code: "LZG", city: "柳州", pinyin: "liuzhou", airports: "白莲" },
  { code: "YCU", city: "运城", pinyin: "yuncheng", airports: "张孝" },
  { code: "LHW", city: "兰州", pinyin: "lanzhou2", airports: "中川" },
  { code: "ZHY", city: "中卫", pinyin: "zhongwei", airports: "沙坡头" },
  { code: "YTY", city: "扬州", pinyin: "yangzhou", airports: "泰州" },
  { code: "LLB", city: "百色", pinyin: "bose", airports: "巴马" },
  { code: "FAT", city: "阜阳", pinyin: "fuyang2", airports: "西关" },
  { code: "BPL", city: "博乐", pinyin: "bole", airports: "阿拉山口" },
  { code: "BYJ", city: "博乐", pinyin: "bole2", airports: "阿拉山口" },
  { code: "KLT", city: "开鲁", pinyin: "kailu", airports: "开鲁" },
  { code: "YCA", city: "银川", pinyin: "yinchuan", airports: "河东" },
  { code: "INC", city: "银川", pinyin: "yinchuan2", airports: "河东" },
  { code: "KRY", city: "克拉玛依", pinyin: "kelamayi", airports: "克拉玛依" },
  { code: "TWF", city: "通辽", pinyin: "tongliao2", airports: "通辽" },
  { code: "NZH", city: "昭通", pinyin: "zhaotong2", airports: "昭通" },
  { code: "JDM", city: "景德镇", pinyin: "jingdezhen", airports: "罗家" },
  { code: "JDZ", city: "景德镇", pinyin: "jingdezhen2", airports: "罗家" },
  { code: "GSN", city: "固原", pinyin: "guyuan", airports: "六盘山" },
  { code: "GYU", city: "固原", pinyin: "guyuan2", airports: "六盘山" },
  { code: "HZH", city: "荔波", pinyin: "libo", airports: "樟江" },
  { code: "BFU", city: "蚌埠", pinyin: "bengbu", airports: "腾湖" },
  { code: "SQD", city: "石河子", pinyin: "shihezi2", airports: "花园" },
  { code: "XNY", city: "兴义", pinyin: "xingyi2", airports: "兴义" },
  { code: "EJN", city: "额济纳", pinyin: "ejina", airports: "桃来" },
  { code: "RHT", city: "阿拉善右", pinyin: "alashanyou", airports: "巴丹吉林" },
  { code: "LFQ", city: "临汾", pinyin: "linfen", airports: "乔李" },
  { code: "CHG", city: "朝阳", pinyin: "chaoyang2", airports: "朝阳" },
  { code: "DAX", city: "达州", pinyin: "dazhou2", airports: "金垭" },
  { code: "LNL", city: "涪陵", pinyin: "fuling", airports: "五桥" },
  { code: "YZL", city: "银川", pinyin: "yinchuan3", airports: "河东" },
  { code: "HUL", city: "呼伦贝尔", pinyin: "hulunbeier", airports: "东山" },
  { code: "NLH", city: "那拉提", pinyin: "nalati", airports: "那拉提" },
  { code: "KJI", city: "喀纳斯", pinyin: "kanasi2", airports: "喀纳斯" },
  { code: "FYN", city: "富蕴", pinyin: "fuyun", airports: "可可托海" },
  { code: "TLM", city: "塔里木", pinyin: "talimu", airports: "塔里木" },
  { code: "YIM", city: "伊宁", pinyin: "yining2", airports: "伊宁" },
  { code: "ZFL", city: "昭苏", pinyin: "zhaosu", airports: "天马" },
  { code: "BXP", city: "博乐", pinyin: "bole3", airports: "阿拉山口" }
];

// Deduplicate by code, keep first occurrence
const seen = new Set();
const UNIQUE_AIRPORTS = [];
for (const item of AIRPORTS) {
  if (!seen.has(item.code)) {
    seen.add(item.code);
    UNIQUE_AIRPORTS.push(item);
  }
}

/**
 * Get first letter of pinyin (uppercase)
 */
function getFirstLetter(pinyin) {
  if (!pinyin) return "#";
  const ch = pinyin.charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : "#";
}

/**
 * Group airports by pinyin first letter, sorted alphabetically
 */
function groupByLetter(list) {
  const groups = {};
  for (const item of list) {
    const letter = getFirstLetter(item.pinyin);
    if (!groups[letter]) {
      groups[letter] = [];
    }
    groups[letter].push(item);
  }

  // Sort within each group by pinyin
  for (const letter of Object.keys(groups)) {
    groups[letter].sort((a, b) => a.pinyin.localeCompare(b.pinyin));
  }

  // Return sorted array of { letter, items }
  return Object.keys(groups)
    .sort()
    .map((letter) => ({ letter, items: groups[letter] }));
}

/**
 * Fuzzy search: match against city name, pinyin, code, airports
 */
function searchAirports(keyword) {
  if (!keyword || !keyword.trim()) {
    return groupByLetter(UNIQUE_AIRPORTS);
  }

  const kw = keyword.trim().toLowerCase();
  const matched = UNIQUE_AIRPORTS.filter((item) => {
    return (
      item.city.toLowerCase().includes(kw) ||
      item.pinyin.includes(kw) ||
      item.code.toLowerCase().includes(kw) ||
      (item.airports && item.airports.toLowerCase().includes(kw))
    );
  });

  return groupByLetter(matched);
}

/**
 * Get city name by code
 */
function getCityByCode(code) {
  if (!code) return "";
  const item = UNIQUE_AIRPORTS.find((a) => a.code === code.toUpperCase());
  return item ? item.city : code;
}

/**
 * Format display: "城市名 (CODE) · 机场"
 */
function formatAirportDisplay(code) {
  if (!code) return "";
  const item = UNIQUE_AIRPORTS.find((a) => a.code === code.toUpperCase());
  if (!item) return code;
  return `${item.city} (${item.code}) · ${item.airports}`;
}

module.exports = {
  AIRPORTS: UNIQUE_AIRPORTS,
  groupByLetter,
  searchAirports,
  getCityByCode,
  formatAirportDisplay
};
