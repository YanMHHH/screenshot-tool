var location_info = 0;
var browser_version;
var hasValid=false;
var isPrompt=false;

/*--为IE8添加.map方法--*/
if (!Array.prototype.map) {
    Array.prototype.map = function(callback, thisArg) {
        var T, A, k;
        if (this == null) {
            throw new TypeError(" this is null or not defined");
        }
        var O = Object(this);
        var len = O.length >>> 0;
        if (typeof callback !== "function") {
            throw new TypeError(callback + " is not a function");
        }
        if (thisArg) {
            T = thisArg;
        }
        A = new Array(len);
        k = 0;
        while(k < len) {
            var kValue, mappedValue;
            if (k in O) {
                kValue = O[ k ];
                mappedValue = callback.call(T, kValue, k, O);

                A[ k ] = mappedValue;
            }
            k++;
        }
        return A;
    };
}

window.console = window.console || (function(){ 
    var c = {}; c.log = c.warn = c.debug = c.info = c.error = c.time = c.dir = c.profile 
    = c.clear = c.exception = c.trace = c.assert = function(){}; 
    return c; 
})();
/*--为IE8添加.map方法  end--*/

window.alert = function(str)
{ 
var shield = document.createElement("DIV"); 
shield.id = "shield"; 
shield.style.position = "absolute"; 
shield.style.left = "0px"; 
shield.style.top = "0px"; 
shield.style.width = "100%"; 
shield.style.height = document.body.scrollHeight+"px"; 
//弹出对话框时的背景颜色 
shield.style.textAlign = "center"; 
shield.style.zIndex = "25"; 
shield.style.backgroundColor = 'black';
shield.style.opacity = 0.6;
shield.style.filter = 'alpha(opacity=60)';
//背景透明 IE有效 
//shield.style.filter = "alpha(opacity=0)"; 
var alertFram = document.createElement("DIV"); 
alertFram.id="alertFram"; 
alertFram.style.position = "absolute"; 
alertFram.style.left = "50%"; 
alertFram.style.top = "50%"; 
alertFram.style.marginLeft = "-225px"; 
alertFram.style.marginTop = "-75px"; 
alertFram.style.width = "350px"; 
alertFram.style.height = "100px"; 
alertFram.style.background = "#ff0000"; 
alertFram.style.textAlign = "center"; 
alertFram.style.lineHeight = "100px";
alertFram.style.zIndex = "300"; 
strHtml = "<ul style=\"list-style:none;margin:0px;padding:0px;width:100%\">\n"; 
strHtml += "<li style=\"background:#d1ab62;text-align:left;padding-left:10px;font-size:14px;font-weight:bold;height:40px;line-height:40px;color:#FCFCFC;font-family:Microsoft YaHei;\">提示框"+
"<div style=\"width:20px;height:20px;background:#fff;border-radius:100%;display:inline-block;color:#000;line-height:20px;text-align:center;position:absolute;right:10px;top:10px;cursor:pointer;\"  onclick=\"doOk()\">X</div></li>\n"; 
strHtml += " <li style=\"background:#ffffff;text-align:center;font-size:12px;height:100px;line-height:24px;padding-top:34px;border-left:1px solid #F0F0F0;border-right:1px solid #F0F0F0;font-family:Microsoft YaHei;\">"+str+"</li>\n"; 
strHtml += " <li style=\"background:#F7F7F7;text-align:center;" +
		"height:50px;line-height:50px; border:1px solid #F0F0F0;color:#FCFCFC;\">" +
		"<input  style=\"background:#d1ab62;text-align:center;width:75px;height:25px;color:#F0F0F0;" +
		"font-family:Microsoft YaHei;display: inline-block;    margin-bottom: 0;"+
    "font-weight: normal;"+
    "text-align: center;"+
    "vertical-align: middle;"+
    "-ms-touch-action: manipulation;"+
    "touch-action: manipulation;"+
    "cursor: pointer;"+
    "background-image: none;"+
    "border: 1px solid transparent;"+
    "white-space: nowrap;"+
    "padding: 6px 12px;"+
    "font-size: 14px;"+
    "line-height: 1;"+
    "border-radius: 4px;"+
    "-webkit-user-select: none;\" type=\"button\" value=\"确定\" onclick=\"doOk()\" /></li>\n"; 
strHtml += "</ul>\n"; 
alertFram.innerHTML = strHtml; 
document.body.appendChild(alertFram); 
document.body.appendChild(shield); 
this.doOk = function(){ 
alertFram.style.display = "none"; 
shield.style.display = "none"; 
} 
alertFram.focus(); 
document.body.onselectstart = function(){return false;}; 
}


function stripscript(s) {
    var pattern = new RegExp("[`~!@#$^&*=|{}':;',\\[\\].<>/?~！ @#￥……&*——|{}【】‘；：”“'。，、？]");
    var rs = "";
    for (var i = 0; i < s.length; i++) {
        rs = rs + s.substr(i, 1).replace(pattern, '');
    }
    return rs;
}

//正则验证字母和数字
function checkRate(nubmer) {
	number_2 = nubmer.replace(/[(|)|（|）]/g, "");
	number_2 = number_2.replace(/(^\s*)|(\s*$)/g, "");
    var re = /^[0-9a-zA-Z]*$/g;  //判断字符串是否为数字和字母（）()组合     //判断正整数 /^[1-9]+[0-9]*]*$/
    if (!re.test(number_2)) {
        return false;
    } else {
        return true;
    }
}

//判断输入的关键字是否存在单个字，比如：“北 京”或“北 京 有”不能搜索，但是“沈阳 有 限”或者“有 北京 限”都是能搜索的
function chechSingleWord(value) {
    value = stripscript(value);
	if (value == "") {
		alert("请输入企业名称、统一社会信用代码或注册号！");
		return false;
	}
	var words = value.split(' ');
	for (var i = 0; i < words.length; i++ ) {
		if (words[i].length > 1) {
			return true;
		}
	}
	alert("请输入更详细的查询条件");
	return false;
}
//正则验证是否全汉字
function load(str) {
	str_2 = str.replace(/[(|)|（|）]/g, "");
	str_2 = str_2.replace(/(^\s*)|(\s*$)/g, "");
    var regex = /^[\u4E00-\u9FA5]+$/;
    if (!regex.test(str_2)) {
        return false;
    } else {
        return true;
    }
}

/** -----------------  极验调整触发时加载，并且只初始化一次极验（20260420调整）开始  ---------------------**/
var gtInited = false;
var gtInitPromise = null;     // 防止并发重复初始化
var pendingAction = null;     // 记录本次验证成功后要执行什么（submit 或 showDetails）

function ensureGeetestReady() {
    if (gtInited && window.gt) {
        return Promise.resolve(window.gt);
    }
    if (gtInitPromise) {
        return gtInitPromise;
    }
    gtInitPromise = new Promise(function (resolve, reject) {
        initGeetest4({
            captchaId: "b608ae7850d2e730b89b02a384d6b9cc",
            product: "bind"
        }, function (gt) {
            window.gt = gt;
            gt.onReady(function () {
                // ready 后标记已初始化
                gtInited = true;
                resolve(gt);
            });
            gt.onSuccess(function () {
                var result = gt.getValidate();
                if (!result) {
                    alert('请完成验证');
                    return;
                }
                $("#lot_number").val(result.lot_number);
                $("#captcha_output").val(result.captcha_output);
                $("#pass_token").val(result.pass_token);
                $("#gen_time").val(result.gen_time);
                $("#captchaId").val("b608ae7850d2e730b89b02a384d6b9cc");
                // 执行本次待处理动作
                if (typeof pendingAction === "function") {
                    pendingAction();
                }
            });
            // 注意：这里不要直接 showBox，让调用方决定什么时候弹出
        });
    }).catch(function (e) {
        // 初始化失败允许下次重试
        gtInitPromise = null;
        gtInited = false;
        throw e;
    });
    return gtInitPromise;
}

function triggerSearchByGeetest() {
    if ($("#keyword").val() == '请输入企业名称、注册号或统一社会信用代码') $("#keyword").val('');
    if (!check()) return;
    isPress = true;
    // 记录本次验证成功后要做的事
    pendingAction = function () {
        if (isPress) {
            $("#search_form").submit();
        } else {
            showDetails(quicksearchurl);
        }
    };
    ensureGeetestReady().then(function (gt) {
        gt.showBox();
    }).catch(function () {
        alert("验证码初始化失败，请刷新页面重试");
    });
}
/** -----------------  极验调整触发时加载，并且只初始化一次极验（20260420调整）结束  ---------------------**/

$(function(){

    $('#btn_query').click(function () {
        triggerSearchByGeetest();
    });

    $("#keyword").on("keypress", function(event){
        if (event.keyCode === 13) {
            $("#keyword").blur();
            triggerSearchByGeetest();
            return false;
        }
    });
	
	/*initGeetest4({
        captchaId: "b608ae7850d2e730b89b02a384d6b9cc",
        product: "bind",
    }, function (gt) {
        window.gt = gt
        gt
            .onReady(function(){
                //验证码ready之后才能调用showCaptcha方法显示验证码

            })
            .onSuccess(function (e) {
                var result = gt.getValidate();
                if (!result) {
                    return alert('请完成验证');
                }
                $("#lot_number").val(result.lot_number);
                $("#captcha_output").val(result.captcha_output);
                $("#pass_token").val(result.pass_token);
                $("#gen_time").val(result.gen_time);
                $("#captchaId").val("b608ae7850d2e730b89b02a384d6b9cc");
                console.log(result);
                if(isPress){
                    $("#search_form").submit();
                }else{
                    showDetails(quicksearchurl);
                }
            })

        $('#btn_query').click(function () {
            if($("#keyword").val()=='请输入企业名称、注册号或统一社会信用代码') $("#keyword").val('');
            if (check()) {
                isPress = true;
                gt.showBox();
            }
        })

        $("#keyword").on("keypress", function(event){
            if (event.keyCode === 13) {
                $("#keyword").blur();
                if($("#keyword").val()=='请输入企业名称、注册号或统一社会信用代码'){
                    $("#keyword").val('');
                }
                if (check()) {
                    isPress = true;
                    gt.showBox();
                }
                return false;
            }
        });
    });*/
	
	
	var str = "";
	for(var i=1;i<=3;i++){
		if(i==1){
			str=str+'<div id="div'+i+'" style="display:block; width:500px">';
		}else{
			str=str+'<div id="div'+i+'" style="display:none; width:500px">';
		}
		str=str+'<table class="hot_grop_td">'
			+'<tr>';
				for(var j=i*3-3;j<i*3&&j<hotSearchData.length;j++){
					str=str+'<td><div class="tab_list"><a href="'+hotSearchData[j].pripid+'" onmouseover="mouseOn();" onmouseout="mouseLeave();" >'+hotSearchData[j].entname+'</a></div></td>';
				}
			str=str+'</tr>'	
		+'</table>'
	+'</div>';
	}
	$('.hot_group').html(str);
});

var data1 = false;

function check() {
	data1 = false;
    //表单提交前验证是否有关键字corp-query-search-test.html
    var xhr = new XMLHttpRequest();
    var val = document.getElementById('keyword');
    var testStr = val.value;

    if (!chechSingleWord(testStr)) {
    	return false;
    }
    testStr = testStr.replace(/ /g,'');
    var flag = checkRate(testStr);
    
    if (flag) {
        //数字和字母组合
        if (val.value.length > 18) {
            alert("您输入的长度超过规定长度，请输入不超过50个汉字或18个数字和字母！");
            return false;
        }
    } else {
        //数字和汉字的组合
        var isChinese = load(testStr);
        if (isChinese) {
            if (testStr.length > 50) {
                alert("您输入的长度超过规定长度，请输入不超过50个汉字或18个数字和字母！");
                return false;
            }
        } else {
            if (testStr.length > 50) {
                alert("您输入的长度超过规定长度，请输入不超过50个字符！");
                return false;
            }
            // alert("只能输入纯汉字或者数字和字母的组合！");
            // return false;
        }
    }

   /*$.ajax({
       type: "get",
       async: false,
       url: "/corp-query-geetest-validate-input.html?token="+location_info,
       dataType: "json",
       success: function(json){
           // console.log("同学, 你在破解我的代码么?");
           eval(json.map(function(item){ return String.fromCharCode(item);}).join(""));
           var token = document.getElementById('token');
           token.value = location_info;
       },
       error: function(){
//           alert('fail');
       }
   });*/

   $.ajax({
       type: "get",
       async: false,  //同步执行，加定时器的前提下依然提前执行了ajax后面的代码，加定时器相当于异步了
       url: "/corp-query-search-test.html",
       data: {searchword: val.value},
       dataType: "json",
       success: function (data) {
           if (data) {
                data1 = true
//               $("#pop-captcha-submit").trigger("click");
                
           } else {
               if (val.value.length != 0) {
                   alert("请输入更为详细的查询条件！")
               } else {
                   alert("请输入企业名称、统一社会信用代码或注册号！");
               }

           }
           console.log(data1 + 'neibu')
       }
   });

//    console.log(data1)

    return data1;
}
var isPress = false;
$(function () {

    $("#submitButton").click(function () {
        $('#mainForm').submit();
    })


    $(".content label").click(function () {

        switch ($(".content").find(".tab-on").prev().attr("src")) {
            case "images/iconfont-shujutianbao2.png":
                $(".tab-on").prev().attr("src", "images/iconfont-shujutianbao.png")
                break;

            case "images/iconfont-rest2.png":
                $(".tab-on").prev().attr("src", "images/iconfont-rest.png")
                break;
        }

        $(".content").find(".tab-on").removeClass("tab-on")

        $(this).addClass("tab-on")
        // $(this).prev().attr("src", "images/iconfont-shujutianbao2.png")
        switch ($(this).prev().attr("src")) {
            case "images/iconfont-shujutianbao.png":
                $(this).prev().attr("src", "images/iconfont-shujutianbao2.png")
                break;

            case "images/iconfont-rest.png":
                $(this).prev().attr("src", "images/iconfont-rest2.png")
                break;

        }


    })

    $(".tabs label").click(function () {
        $(".tabs").find(".tab-in").next().hide()
        $(".tabs").find(".tab-in").removeClass("tab-in")
        $(this).addClass("tab-in")
        $(this).next().show()

    })

    $(".choosetabs span").click(function () {
        $(".choosetabs").find(".tab2in").removeClass("tab2in")
        $(this).addClass("tab2in")

        switch ($(this).attr("name")) {
            case "tab1":
                $(".span1").css("background", "#4164a7")
                $(".span2").css("background", "#fff")

                break;

            case "tab2":
                $(".span2").css("background", "#4164a7")
                $(".span1").css("background", "#fff")

                break;

        }
    })

    $('.search_items > span').click(function () {
        $('.search_items').find('.selected').removeClass('selected');
        // 搜索功能切换
        switch ($(this).attr("class")) {
            case "entInfo":
                $("input[name=tab]").val("ent_tab")
                break;
            case "abnormal":
                $("input[name=tab]").val("excep_tab")
                break;
            case "serious":
                $("input[name=tab]").val("ill_tab")
                break;
        }

        $(this).addClass('selected');

    })

    var date = new Date();
    var timestamp = date.getMinutes() + date.getSeconds();


   /*$.ajax({
       type: "get",
       async: false,
       url: "/corp-query-custom-geetest-image.gif?v=" + timestamp,
       dataType: "json",
       success: function(json){
           eval( json.map( function(item){ return String.fromCharCode(item);}).join(""));
           browser_version = check_browser;
       },
       error: function(){
//           alert('fail');
       }
   });*/
    
})
var  provinceTonum = {
    '北京':110000,'天津':120000,'河北':130000,'山西':140000,'内蒙古':150000,'辽宁':210000,'吉林':220000,'黑龙江':230000,'上海':310000,'江苏':320000,
    '浙江':330000,'安徽':340000,'福建':350000,'江西':360000,'山东':370000,'广东':440000,'广西':450000,'海南':460000,'河南':410000,'湖北':420000,
    '湖南':430000,'重庆':500000,'四川':510000,'贵州':520000,'云南':530000,'西藏':540000,'陕西':610000,'甘肃':620000,'青海':630000,'宁夏':640000,
    '新疆':650000,'兵团':660000
};
//正式上线使用的首页地址
var homepageaddr = {
    "国家企业信用信息公示系统":"https://www.gsxt.gov.cn",
    "北京":"https://bj.gsxt.gov.cn",
    "天津":"https://tj.gsxt.gov.cn",
    "河北":"https://he.gsxt.gov.cn",
    "山西":"https://sx.gsxt.gov.cn",
    "内蒙古":"https://nm.gsxt.gov.cn",
    "辽宁":"https://ln.gsxt.gov.cn",
    "吉林":"https://jl.gsxt.gov.cn",
    "黑龙江":"https://hl.gsxt.gov.cn",
    "上海":"https://sh.gsxt.gov.cn",
    "江苏":"https://js.gsxt.gov.cn",
    "浙江":"https://zj.gsxt.gov.cn",
    "安徽":"https://ah.gsxt.gov.cn",
    "福建":"https://fj.gsxt.gov.cn",
    "江西":"https://jx.gsxt.gov.cn",
    "山东":"https://sd.gsxt.gov.cn",
    "河南":"https://ha.gsxt.gov.cn",
    "湖北":"https://hb.gsxt.gov.cn",
    "湖南":"https://hn.gsxt.gov.cn",
    "广东":"https://gd.gsxt.gov.cn",
    "广西":"https://gx.gsxt.gov.cn",
    "海南":"https://hi.gsxt.gov.cn",
    "重庆":"https://cq.gsxt.gov.cn",
    "四川":"https://sc.gsxt.gov.cn",
    "贵州":"https://gz.gsxt.gov.cn",
    "云南":"https://yn.gsxt.gov.cn",
    "西藏":"https://xz.gsxt.gov.cn",
    "陕西":"https://sn.gsxt.gov.cn",
    "甘肃":"https://gs.gsxt.gov.cn",
    "青海":"https://qh.gsxt.gov.cn",
    "宁夏":"https://nx.gsxt.gov.cn",
    "新疆":"https://xj.gsxt.gov.cn",
    "兵团":"https://bt.gsxt.gov.cn"
}
//开发使用的首页地址
var homepageaddr_sm = {
    "国家企业信用信息公示系统":"corp-query-homepage.html",
    "北京":"subPubSys-110000.html",
    "天津":"subPubSys-120000.html",
    "河北":"subPubSys-130000.html",
    "山西":"subPubSys-140000.html",
    "内蒙古":"subPubSys-150000.html",
    "辽宁":"subPubSys-210000.html",
    "吉林":"subPubSys-220000.html",
    "黑龙江":"subPubSys-230000.html",
    "上海":"subPubSys-310000.html",
    "江苏":"subPubSys-320000.html",
    "浙江":"subPubSys-330000.html",
    "安徽":"subPubSys-340000.html",
    "福建":"subPubSys-350000.html",
    "江西":"subPubSys-360000.html",
    "山东":"subPubSys-370000.html",
    "河南":"subPubSys-410000.html",
    "湖北":"subPubSys-420000.html",
    "湖南":"subPubSys-430000.html",
    "广东":"subPubSys-440000.html",
    "广西":"subPubSys-450000.html",
    "海南":"subPubSys-460000.html",
    "重庆":"subPubSys-500000.html",
    "四川":"subPubSys-510000.html",
    "贵州":"subPubSys-520000.html",
    "云南":"subPubSys-530000.html",
    "西藏":"subPubSys-540000.html",
    "陕西":"subPubSys-610000.html",
    "甘肃":"subPubSys-620000.html",
    "青海":"subPubSys-630000.html",
    "宁夏":"subPubSys-640000.html",
    "新疆":"subPubSys-650000.html",
    "兵团":"subPubSys-660000.html"
}

var teladdr = {
    '100000':'tel.html',
    '110000':'http://bj.gsxt.gov.cn/sydq/loginSydqAction!jszc.dhtml',
    '120000':'http://www.tjxy.gov.cn/gsnb/jsp/saic/dianhua.jsp',
    '310000':'http://sh.gsxt.gov.cn/notice/search/search_telephone',
    '500000':'http://cq.gsxt.gov.cn/common/jslxzc.html',
    '130000':'http://he.gsxt.gov.cn/notice/search/search_telephone',
    '140000':'http://sx.gsxt.gov.cn/zxPhone.jspx',
    '210000':'http://ln.gsxt.gov.cn/saicpub/entPublicitySC/entPublicityDC/include/zxfwNew.jsp',
    '220000':'http://jl.gsxt.gov.cn/Contact.html',
    '230000':'http://hl.gsxt.gov.cn/zxPhone.jspx',
    '320000':'http://www.jsgsj.gov.cn:58888/province/system/tel.jsp',
    '330000':'http://zj.gsxt.gov.cn/client/entsearch/contact',
    '340000':'http://ah.gsxt.gov.cn/zxPhone.jspx',
    '350000':'http://fj.gsxt.gov.cn/notice/search/search_telephone',
    '360000':'http://jx.gsxt.gov.cn/pages/contact.jsp',
    '370000':'http://sd.gsxt.gov.cn/pub/hotphone',
    '410000':'http://ha.gsxt.gov.cn/zxPhone.jspx',
    '420000':'http://hb.gsxt.gov.cn/zxPhone.jspx',
    '430000':'http://hn.gsxt.gov.cn/notice/search/search_telephone',
    '440000':'http://gd.gsxt.gov.cn/aiccips//main/consult.html',
    '460000':'http://hi.gsxt.gov.cn/zxPhone.jspx',
    '510000':'http://sc.gsxt.gov.cn/ztxy.do?method=changeTel&random=2110095111',
    '520000':'http://gz.gsxt.gov.cn/2016/frame/services.jsp',
    '530000':'http://gsxt.ynaic.gov.cn/notice/search/search_telephone',
    '610000':'http://sn.gsxt.gov.cn/ztxy.do?method=shanxiTel&random=2110095111',
    '620000':'http://gs.gsxt.gov.cn/gsxygs/pubSearch/footerLink',
    '630000':'http://qh.gsxt.gov.cn/zxPhone.jspx',
    '150000':'http://nm.gsxt.gov.cn:58888/main/consult.html',
    '450000':'http://gx.gsxt.gov.cn/sydq/loginSydqAction!gxjszc.dhtml',
    '540000':'http://xz.gsxt.gov.cn/zxPhone.jspx',
    '640000':'http://nx.gsxt.gov.cn/indexAction_phoneList.action',
    '650000':'http://xj.gsxt.gov.cn/sydq/loginSydqAction!xj_jszc.dhtml'
}
function addLinks(){
    $('#choose_state').hover(function(){
        if(!$('.loadingView').html()){
            $('.state_box').show();
            return false;
        }
        $(this).addClass('activing');
        var dh_addr=homepageaddr;
        var sn = $('#s_n').val();
       if (sn == 'sm') {
            dh_addr = homepageaddr_sm;
        }
       $('.loadingView').remove();
       var as = $('.state_box').find('a');
       as.each(function(){
   		if($(this).html().length<4){
   			$(this).attr('href',dh_addr[$(this).html()]).attr('target','_blank');
           }
       });
       if(!$('#choose_state').hasClass('activing')) return;
       $('.state_box').show();
   	$("#zj_link").attr("href",dh_addr[$("#zj_link").html()]);

      //后台取导航连接
      // $.ajax({
      // type:'post',
      // url:'index/getDhUrl',
      // dataType:'json',
      // success:function(data){
    	//
    	//   homepageaddr=data;
    	//   $('.loadingView').remove();
      //     var as = $('.state_box').find('a');
      //     as.each(function(){
      // 		if($(this).html().length<4){
      // 			$(this).attr('href',homepageaddr[$(this).html()]).attr('target','_blank');
      //         }
      //     });
      //     if(!$('#choose_state').hasClass('activing')) return;
      //     $('.state_box').show();
      // 	$("#zj_link").attr("href",homepageaddr[$("#zj_link").html()]);
      // }
      // });
      
        
    	
 /**       
//        $.ajax({
//            type:'post',
//            url:'index/getLinks',
//            dataType:'json',
//            success:function(data){
//                $('.loadingView').remove();
//                var as = $('.state_box').find('a');
//                as.each(function(){
//                	if(data[provinceTonum[$(this).html()]] == undefined || data[provinceTonum[$(this).html()]].length == 0) {
//                		$(this).css("color","#999");
//                	} else {
//                		if($(this).html().length<4){
//                            //$(this).attr('href',data[provinceTonum[$(this).html()]]).attr('target','_blank');
//                			$(this).attr('href','subPubSys-'+provinceTonum[$(this).html()]+'.html');
//                        }
//                	}
//                });
//                if(!$('#choose_state').hasClass('activing')) return;
//                $('.state_box').show();
//            	$("#zj_link").attr("href",data['100000']);
//            }
//        });
**/
    },function(){
        $('.state_box').hide();
        $(this).removeClass('activing');
    });
}

function inputPlaceholder(){
    var input=$('#keyword');
    input.css({'color':'#999'}).val('请输入企业名称、注册号或统一社会信用代码');
    input.on('focus',function(){
        if($(this).val()=='请输入企业名称、注册号或统一社会信用代码'){
            $(this).removeAttr('style').val('');
        }
    });
    input.on('blur',function(){
        if($(this).val()=='请输入企业名称、注册号或统一社会信用代码' ||$(this).val()==''){
            $(this).css({'color':'#999'}).val('请输入企业名称、注册号或统一社会信用代码');
        }
    });
}

function addTelLinks(){
    if($('#subsite').val()==120000){
      $('#subsite').next().attr('href',teladdr[$('#subsite').val()]);  
    }
}

$(document).ready(function(){
    if(navigator.appName == "Microsoft Internet Explorer" && navigator.appVersion.match(/8./i)=="8."){
        inputPlaceholder();

        /**IE8首页兼容1024分辨率**/
        var width = $(window).width();
        if(width<=1160){
            $('.body_layout').css({'min-width':960});
            $('.body-1140').css({'width':960,'margin-left':-480});
            $('.body-min1400-df').css({'min-width':960});
            $('.main-layout').css({'width':960});
            $('.body-min1400').css({'min-width':960});
            $('.footer2').css({'min-width':960});
        }else{
            $('.body_layout').removeAttr('style');
            $('.body-1140').removeAttr('style');
            $('.body-min1400-df').removeAttr('style');
            $('.main-layout').removeAttr('style');
            $('.body-min1400').removeAttr('style');
            $('.footer2').removeAttr('style');
        }
        /**IE8首页兼容1024分辨率 end**/

    }else if(navigator.appName == "Microsoft Internet Explorer" && navigator.appVersion.match(/9./i)=="9."){
        inputPlaceholder();
    }
    
    $('.search_items').find('span').removeClass('selected');
    switch($("input[name=tab]").val()){
        case "ent_tab": $('.search_items').find('.entInfo').addClass('selected');break;
        case "excep_tab": $('.search_items').find('.abnormal').addClass('selected');break;
        case "ill_tab": $('.search_items').find('.serious').addClass('selected');break;
    }
    addLinks();
    addTelLinks();
});

$(window).resize(function(){
    /**IE8首页兼容1024分辨率**/
    if(navigator.appName == "Microsoft Internet Explorer" && navigator.appVersion.match(/8./i)=="8."){
        var width = $(window).width();
        if(width<=1160){
            $('.body_layout').css({'min-width':960});
            $('.body-1140').css({'width':960,'margin-left':-480});
            $('.body-min1400-df').css({'min-width':960});
            $('.main-layout').css({'width':960});
            $('.body-min1400').css({'min-width':960});
            $('.footer2').css({'min-width':960});
        }else{
            $('.body_layout').removeAttr('style');
            $('.body-1140').removeAttr('style');
            $('.body-min1400-df').removeAttr('style');
            $('.main-layout').removeAttr('style');
            $('.body-min1400').removeAttr('style');
            $('.footer2').removeAttr('style');
        }
    }
    /**IE8首页兼容1024分辨率 end**/
});

//点击图标
function Link(site_code) {
    //获取该站点需要纠错页面的url地址
    var url = getCurrUrl();
    //跳转至纠错系统填写页面
    //window.open("http://121.43.68.40/exposure/jiucuo.html?site_code=" + site_code + "&url=" + encodeURIComponent(url));
    window.open("https://zfwzgl.www.gov.cn/exposure/jiucuo.html?site_code=" + site_code + "&url=" + encodeURIComponent(url));
}
//获取该站点需要纠错页面的url地址
function getCurrUrl() {
    var url = "";
    if (parent !== window) {
        try {
            url = window.top.location.href;
        } catch (e) {
            url = window.top.document.referrer;
        }
    }
    if (url.length == 0)
        url = document.location.href;

    return url;
}
function moveTo(province) {
	$("#province").val(province);
	$("#search_form").attr("action", "subPubSys.html"); 
	$("#search_form").submit();
}

function showBigPic(filepath) {
	console.log(filepath);
	
	var _event = window.event || arguments.callee.caller.arguments[0];
    //将文件路径传给img大图
    document.getElementById('pre_view').src = filepath;
    //获取大图div是否存在
    var div = document.getElementById("bigPic");
    if (!div) {
        return;
    }
    //如果存在则展示
    document.getElementById("bigPic").style.display="block";
    var intX = _event.clientX;
    var intY = _event.clientY;
    
//    var xpix=document.body.clientWidth;
    var ypix=document.body.clientHeight;
    //设置大图左上角起点位置
    div.style.left = intX +10+ "px";
    div.style.bottom = ypix-intY + 30+"px";
//    div.style.left=xpix/2-150+"px";
//    div.style.bottom=ypix/2-150+"px";
}

//隐藏
function closeimg(){
    document.getElementById("bigPic").style.display="none";
}
