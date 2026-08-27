$(function() {
	// 获取url 参数 -- 开始

	(function ($) {
		$.getUrlParam = function (name) {
			var reg = new RegExp("(^|&)" + name + "=([^&]*)(&|$)");
			var r = window.location.search.substr(1).match(reg);
			if (r != null) return unescape(r[2]); return null;
		}
	})(jQuery);

	// 结束
	var mySwiper = new Swiper('#rotationChart', {
		direction: 'horizontal',
		loop: true,
		autoplay: true,
	})

	var merryGoRound = new Swiper('#merryGoRound', {
		direction: 'vertical', // 垂直切换选项
		loop: true,
		autoplay: true, //可选选项，自动滑动
		observer: true, //修改swiper自己或子元素时，自动初始化swiperz`
		observeParents: true, //修改swiper的父元素时，自动初始化swiper
	})

  $('.gyszc').click(function(){
  	$('.msgBox').css('display','block')
  })
	$('.msg-close').click(function(){
		$('.msgBox').css('display','none')
	})
	$('.msg-button .old').click(function(){
		$('.msgBox').css('display','none')
	})
	$('.msg-button .new').click(function(){
		$('.msgBox').css('display','none')
	})


	$('.websiteSwitch').hover(
		function() {
			$('.otherRelatedWebsites').css('display', 'block')
		},
		function() {
			$('.otherRelatedWebsites').css('display', 'none')
		}
	)
	$('.hidden-map').click(function () {
		$('.hlj—map').animate({left: '-122px'},300);
		$('.hlj—map').css('height','40px');
		$('.hlj—map').css('width','210px');
		$('.show-map').css('display','block');
		$('.show-map').css('top','0px');
		$('.hidden-map').css('display','none');
		$('.hlj-map-title').css('height','90px');
		$('.hlj-map-title').css('background','#fff');
		$('.hlj-map-title').css('color','#000');
		$('.hlj-map-title').css('padding','10px 0 0 120px');
		$('.otherRelatedWebsites').css('display','none');
		$('.iconDivision1').css('display','none');
		$('.iconDivision2').css('display','block');
	})
	$('.show-map').click(function () {
		$('.hlj—map').animate({left: '0'},300);
		$('.hlj—map').css('height','528');
		$('.hlj—map').css('width','242px');
		$('.hidden-map').css('display','block');
		$('.show-map').css('display','none');
		// $('.hlj-map-title').css('width','222px');
		$('.hlj-map-title').css('height','40px');
		$('.hlj-map-title').css('background','#2461B1');
		$('.hlj-map-title').css('color','#fff');
		$('.hlj-map-title').css('padding','0px');
		$('.otherRelatedWebsites').css('display','block');
		$('.iconDivision1').css('display','inline-block');
		$('.iconDivision2').css('display','none');
	})
	// $('.announcementsList').hover(
	// 	function() {
	// 		($(this).find('.time')).addClass('hover');
	// 		($(this).find('.title')).addClass('hover');
	// 	},
	// 	function() {
	// 		($(this).find('.title')).removeClass('hover');
	// 		($(this).find('.time')).removeClass('hover');
	// 	}
	// )
	//
	// $('.noticeAndSpecialAreaTitle').find('li').hover(
	//
	// 	function() {
	// 		($(this).find('.ellipsis')).addClass('hover');
	// 	},
	// 	function() {
	// 		($(this).find('.ellipsis')).removeClass('hover');
	// 	}
	// )
	//
	// $('.supervisionTitle').find('li').hover(
	// 	function() {
	// 		($(this).find('.ellipsis')).addClass('hover');
	// 	},
	// 	function() {
	// 		($(this).find('.ellipsis')).removeClass('hover');
	// 	}
	// )
	// $('.containerHide').find('li').hover(
	// 	function() {
	// 		($(this).find('.ellipsis')).addClass('hover');
	// 	},
	// 	function() {
	// 		($(this).find('.ellipsis')).removeClass('hover');
	// 	}
	// )

	// $('.nav-tab li').hover(function(){
	// 	$(this).addClass('bg-active').siblings().removeClass('bg-active')
	// })


// // 地图
// 	var dq_url = $('#echarsMap p')
// 	var name = ''
// 	var url = ''
// 	var urlList = []
// 	for (var i=0;i<dq_url.length;i++){
// 		name = dq_url[i].children[0].innerText
// 		url = dq_url[i].children[1].innerText
// 		urlList.push({'name':name,'url':url})
// 	}
// 	var url =$('#mapJson').attr('codes')
// 	$.get(url, function(map) {
// 		// debugger
// 		var myChart = echarts.init(document.getElementById('echarsMap'));
// 		echarts.registerMap("sichuan", map);
// 		var option = {
// 			series: [{
// 				map: "sichuan",
// 				type: "map",
// 				aspectScale: 0.85,
// 				zoom: 1.2,
// 				selectedMode: 'single', //选择类型,
// 				hoverable: true, //鼠标经过高亮
// 				roam: true, //鼠标滚轮缩放
// 				animationType: 'scale',
// 				animationEasing: 'elasticOut',
// 				confine: true,
// 				label: {
// 					normal: {
// 						show: true, //显示市份标签
// 						textStyle: {
// 							color: "#fff",
// 							fontSize:7,
// 						} //市份标签字体颜色
// 					},
// 					emphasis: { //对应的鼠标悬浮效果
// 						show: false,
// 						textStyle: {
// 							color: "#800080"
// 						}
// 					}
// 				},
// 				itemStyle: {
// 					normal: {
// 						borderWidth: .12, //区域边框宽度
// 						borderColor: '#FFF', //区域边框颜色
// 						areaColor: "#4C83EA", //区域颜色
// 					},
// 					emphasis: {
// 						borderWidth: .1,
// 						borderColor: '#4b0082',
// 						areaColor: "#ffdead",
// 					}
// 				},
// 				data: [
// 					{ name: '成都市', selected: false, value: 1 },
// 					{ name: '自贡市', selected: false, value: 2 },
// 					{ name: '攀枝花市', selected: false, value: 3 },
// 					{ name: '泸州市', selected: false, value: 4 },
// 					{ name: '德阳市', selected: false, value: 5 },
// 					{ name: '绵阳市', selected: false, value: 6 },
// 					{ name: '广元市', selected: false, value: 7 },
// 					{ name: '遂宁市', selected: false, value: 8 },
// 					{ name: '内江市', selected: false, value: 9 },
// 					{ name: '乐山市', selected: false, value: 10 },
// 					{ name: '南充市', selected: false, value: 11 },
// 					{ name: '眉山市', selected: false, value: 12 },
// 					{ name: '宜宾市', selected: false, value: 13 },
// 					{ name: '广安市', selected: false, value: 14 },
// 					{ name: '达州市', selected: false, value: 15 },
// 					{ name: '雅安市', selected: false, value: 16 },
// 					{ name: '巴中市', selected: false, value: 17 },
// 					{ name: '资阳市', selected: false, value: 18 },
// 					{ name: '阿坝州', selected: false, value: 19 },
// 					{ name: '甘孜州', selected: false, value: 20 },
// 					{ name: '凉山州', selected: false, value: 21 },
// 				]//各市地图颜色数据依赖value
// 			}],
// 			dataRange: {
// 				x: '-1000 px', //图例横轴位置
// 				y: '-1000 px', //图例纵轴位置
// 				splitList: [
// 					{ start: 1, end: 1, label: '成都市', color: '#4378DD' },
// 					{ start: 2, end: 2, label: '自贡市', color: '#4C83EA' },
// 					{ start: 3, end: 3, label: '攀枝花市', color: '#4C83EA' },
// 					{ start: 4, end: 4, label: '泸州市', color: '#4C83EA' },
// 					{ start: 5, end: 5, label: '德阳市', color: '#4C83EA' },
// 					{ start: 6, end: 6, label: '绵阳市', color: '#4C83EA' },
// 					{ start: 7, end: 7, label: '广元市', color: '#4C83EA' },
// 					{ start: 8, end: 8, label: '遂宁市', color: '#4C83EA' },
// 					{ start: 9, end: 9, label: '内江市', color: '#4C83EA' },
// 					{ start: 10, end: 10, label: '乐山市', color: '#4C83EA' },
// 					{ start: 11, end: 11, label: '南充市', color: '#FFAB59' },
// 					{ start: 12, end: 12, label: '眉山市', color: '#4C83EA' },
// 					{ start: 13, end: 13, label: '宜宾市', color: ' #5B91F7' },
// 					{ start: 14, end: 14, label: '广安市', color: '#4C83EA' },
// 					{ start: 15, end: 15, label: '达州市', color: '#4C83EA' },
// 					{ start: 16, end: 16, label: '雅安市', color: '#FFAB59' },
// 					{ start: 17, end: 17, label: '巴中市', color: '#4C83EA' },
// 					{ start: 18, end: 18, label: '资阳市', color: ' #5B91F7' },
// 					{ start: 16, end: 16, label: '阿坝州', color: '#4C83EA' },
// 					{ start: 17, end: 17, label: '甘孜州', color: '#4C83EA' },
// 					{ start: 18, end: 18, label: '凉山州', color: ' #4C83EA' },
// 				]//各市地图颜色；start：值域开始值；end：值域结束值；label：图例名称；color：自定义颜色值
// 			},
// 		};
// 		myChart.setOption(option);
// 		myChart.on('click', function(params) {
// 			for (var i=0;i<urlList.length;i++){
// 				if(urlList[i].name==params.name){
// 					window.open(urlList[i].url,'_blank');
// 				}
// 			}
// 		});
// 	});
});
// 提取原调接口contextpathNo部分
function getFreecms() {
	return "/freecms";
}

