    //加密时间戳方法
    function encryptByRSA(value) {
        var encrypt = new JSEncrypt();
        var RSAPublicKey = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCS2TZDs5+orLYCL5SsJ54+bPCV\n" +
            "s1ZQQwP2RoPkFQF2jcT0HnNNT8ZoQgJTrGwNi5QNTBDoHC4oJesAVYe6DoxXS9Nl\n" +
            "s8WbGE8ZNgOC5tVv1WVjyBw7k2x72C/qjPoyo/kO7TYl6Qnu4jqW/ImLoup/nsJp\n" +
            "pUznF0YgbyU/dFFNBQIDAQAB";
        encrypt.setPublicKey('-----BEGIN PUBLIC KEY-----'+RSAPublicKey+'-----END PUBLIC KEY-----')  // 放置自己的公钥
        return encrypt.encrypt(value)
    }
    // 获取url参数
    function getQueryString(name) {
        var reg = new RegExp("(^|&)" + name + "=([^&]*)(&|$)", "i");
        var r = window.location.search.substr(1).match(reg);
        if (r != null) return unescape(r[2]); return null;
    }
    // 判断url的?后参数是否包含某个字符串
    function GetQueryString(name){
        var reg=eval("/"+name+"/g");
        var r = window.location.search.substr(1);
        var flag=reg.test(r);
        if(flag){
            return true;
        }else{
            return false;
        }
    }
    // 打印
    function printHtml(html) {
        var bodyHtml = document.body.innerHTML;
        document.body.innerHTML = html;
        window.print();
        document.body.innerHTML = bodyHtml;
    }

    // 获取url中"?"符后的字串
    function GetRequest() {
        var url = location.search;
        var theRequest = new Object();
        if (url.indexOf("?") != -1) {
            var str = url.substr(1);
            strs = str.split("&");
            for(var i = 0; i < strs.length; i ++) {
                theRequest[strs[i].split("=")[0]]=decodeURI(strs[i].split("=")[1]);
            }
        }
        return theRequest;
    }

    // 时间戳转时分秒
    function formatDate (value) {
        if (typeof (value) == 'undefined') {
            return ''
        } else {
            let date = new Date(parseInt(value))
            let y = date.getFullYear()
            let MM = date.getMonth() + 1
            MM = MM < 10 ? ('0' + MM) : MM
            let d = date.getDate()
            d = d < 10 ? ('0' + d) : d
            let h = date.getHours()
            h = h < 10 ? ('0' + h) : h
            let m = date.getMinutes()
            m = m < 10 ? ('0' + m) : m
            let s = date.getSeconds()
            s = s < 10 ? ('0' + s) : s
            return y + '-' + MM + '-' + d + ' ' + h + ':' + m + ':' + s
        }
    }
    // 近天数
    function getDay(day){
        var today = new Date();
        var targetday_milliseconds = today.getTime() + 1000 * 60 * 60 * 24 * day;
        today.setTime(targetday_milliseconds);
        var tYear = today.getFullYear();
        var tMonth = today.getMonth();
        var tDate = today.getDate();
        tMonth = doHandleMonth(tMonth + 1);
        tDate = doHandleMonth(tDate);
        return tYear + '-' + tMonth + '-' + tDate + ' ' + '00:00:00';
    }
    function doHandleMonth(month){
        var m = month;
        if(month.toString().length == 1){
            m = "0" + month;
        }
        return m;
    }

    // 近一个月
    function getLastMonth() {
        var now = new Date();
        var year = now.getFullYear();
        var month = now.getMonth() + 1;
        var day = now.getDate();
        var dateObj = {};
        dateObj.now = year + '-' + month + '-' + day;
        var nowMonthDay = new Date(year, month, 0).getDate();
        if(month - 1 <= 0){
            dateObj.last = (year - 1) + '-' + 12 + '-' + day;
        }else{
            var lastMonthDay = new Date(year, (month - 1), 0).getDate();
            month = month - 1
            if(month<10) {
                month =  '0' + month;
            }
            if(day<10) {
                day =  '0' + day;
            }
            if(lastMonthDay < day){
                if(day < nowMonthDay){
                    var monthDay = lastMonthDay - (nowMonthDay - day)
                    if(monthDay<10) {
                        monthDay =  '0' + monthDay;
                    }
                    dateObj.last = year + '-' + month + '-' + monthDay + ' ' + '00:00:00';
                }
                else{
                    if(lastMonthDay<10) {
                        lastMonthDay =  '0' + lastMonthDay;
                    }
                    dateObj.last = year + '-' + month + '-' + lastMonthDay + ' ' + '00:00:00';
                }
            }
            else{
                dateObj.last = year + '-' + month + '-' + day + ' ' + '00:00:00';
            }
        }

        return dateObj;
    }

    // 近3个月
    function getLast3Month() {
        var now = new Date();
        var year = now.getFullYear();
        var month = now.getMonth() + 1;
        var day = now.getDate();
        var dateObj = {};
        dateObj.now = year + '-' + month + '-' + day;
        var nowMonthDay = new Date(year, month, 0).getDate();
        if(month - 3 <= 0){
            var last3MonthDay = new Date((year - 1), (12 - (3 - parseInt(month))), 0).getDate();
            month = 12 - (3 - month);
            if(month<10){
                month = '0' + month;
            }
            if(last3MonthDay < day){
                if(last3MonthDay<10){
                    last3MonthDay = '0' + last3MonthDay;
                }
                dateObj.last = (year - 1) + '-' + month + '-' + last3MonthDay + ' ' + '00:00:00';
            }else{
                if(day<10){
                    day = '0' + day;
                }
                dateObj.last = (year - 1) + '-' + month + '-' + day + ' ' + '00:00:00';
            }
        }else{
            var last3MonthDay = new Date(year, (parseInt(month) - 3), 0).getDate();
            month = month - 3;
            if(month<10){
                month = '0' + month
            }
            if(last3MonthDay < day){
                if(day < nowMonthDay){
                    var MonthDay3 = last3MonthDay - (nowMonthDay - day);
                    if(MonthDay3<10){
                        MonthDay3 = '0' + MonthDay3
                    }
                    dateObj.last = year + '-' + month + '-' + MonthDay3 + ' ' + '00:00:00';
                }else{
                    if(last3MonthDay<10){
                        last3MonthDay = '0' + last3MonthDay
                    }
                    dateObj.last = year + '-' + month + '-' + last3MonthDay + ' ' + '00:00:00';
                }
            }else{
                if(day<10){
                    day = '0' + day
                }
                dateObj.last = year + '-' + month + '-' + day + ' ' + '00:00:00';
            }
        }
        return dateObj;
    }

    // 近半年
    var half_years = new Date();
    var half_year_Time = new Date().getTime()
    var halfYear = 365 / 2 * 24 * 3600 * 1000;
    var pastResult = half_year_Time - halfYear
    var pastDate = new Date(pastResult),
        pastYear = pastDate.getFullYear(),
        pastMonth = pastDate.getMonth() + 1,
        pastDay = pastDate.getDate();
        halfYears = half_years.getFullYear();
        halfDay = half_years.getDate()
        years = half_years.getFullYear() - 1;
        yearsMonth = half_years.getMonth()+ 1;
        if(pastMonth<10){
            halfMonth = '0' + pastMonth;
        }
        if(yearsMonth<10){
            yearsMonth = '0' + yearsMonth;
        }
        if(halfDay<10){
            halfDay = '0' + halfDay;
        }
    // 当前时间
    toLocaleDateString = halfYears + '-' + yearsMonth + '-'+ halfDay + ' ' + '23:59:59';
    // 近半年
    getLastYear = pastYear + '-' + pastMonth + '-'+ halfDay + ' ' + '00:00:00';
    // 近一年
    getYears = years + '-' + yearsMonth + '-'+ halfDay + ' ' + '00:00:00';

    // 数组求和
    function arraySum(arr) {
        var len = arr.length;
        if(len == 0){
            return 0;
        } else if (len == 1){
            return arr[0];
        } else {
            return arr[0] + arraySum(arr.slice(1));
        }
    }

