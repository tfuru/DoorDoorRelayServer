/** DoorDoorBeacon の 処理をするオブジェクト
 * 
 */
var noble = require('noble');
var CronJob = require('cron').CronJob;
var jsonServer = require('json-server');
var low = require('lowdb');

var DoorDoorBeacon = function(){
	var _self = this;
	
	//3分毎にタスクを実行 crontab書式
	//this.cronTime = "*/3 * * * *";
	this.cronTime = "*/1 * * * *";
	
	//DoorDoorBeaconサービス UUID
	this.DOOR_DOOR_BEACON_SERVICE_UUID = "6b33221e13a2de8ec9487cff438fb17c";
	
	//スイッチ状態のステータス UUID
	this.DOOR_DOOR_BEACON_CHARACTERISTIC_SWITCH_UUID = "c369bc4e4cecb999284410df871060f5";
	
	//見つかったビーコン一覧
	this.beaconList = {};
	
	//json-serverを生成
	this.server = jsonServer.create();
	this.db = low('db.json');
	
	//検索を開始
	this.start = function(){
		noble.on('stateChange', _self.ddbstateChange);
		noble.on('discover', _self.ddbDiscover);
		//cron 処理を開始
		_self.job.start();
		
		//json-serverを初期化
		_self.initJsonServer();
	}
	
	//ペリフェラルの情報をログに出力
	this.showPeripheralLog = function( peripheral ){
	    var advertisement = peripheral.advertisement;
	    var serviceUuids = advertisement.serviceUuids;
	    var localName = advertisement.localName;
	    var txPowerLevel = advertisement.txPowerLevel;
	    var manufacturerData = advertisement.manufacturerData;
	    var serviceData = advertisement.serviceData;
	    
	    console.log('-------');
	    console.log('uuid = ' + peripheral.uuid);
	    console.log('address = ' + peripheral.address);
	    if (serviceUuids) {
	        console.log('  Service UUIDs     = ' + serviceUuids);
	    }
	    if (localName) {
	        console.log('  Local Name        = ' + localName);
	    }

	    if (txPowerLevel) {
	        console.log('  TX Power Level    = ' + txPowerLevel);
	    }

	    if (manufacturerData) {
	        console.log('  Manufacturer Data = ' + manufacturerData.toString('hex'));
	    }

	    if (serviceData) {
	        console.log('  Service Data      = ' + serviceData.toString('hex'));
	    }
	    console.log('-------');
	}
	
	this.ddbstateChange = function( state ){
	  if (state === 'poweredOn') {
		  noble.startScanning();
	  } else {
		  noble.stopScanning();
	  }	
	}

	//ビーコンが見つかると呼び出される
	this.ddbDiscover = function( peripheral ){
		console.log('noble discover');
		if(typeof peripheral.advertisement.localName == 'undefined'){
			return;
		}
		
		//サービスUUIDを取得
	    var serviceUuids = peripheral.advertisement.serviceUuids;    
	    if(_self.DOOR_DOOR_BEACON_SERVICE_UUID != serviceUuids){
	    	//対象外のサービスだったので以下の処理をしない
	    	return;
	    }
	    
	    //接続時
	    peripheral.on('connect', _self.ddbConnect);
	 
	    //切断
	    peripheral.on('disconnect', _self.ddbDisconnect);
	    
	    //サービス列挙後に ビーコンに接続して情報を取得する
	    peripheral.on('servicesDiscover', _self.ddbServicesDiscover);
	    
	    //ペリフェラルの情報をログに出力
	    _self.showPeripheralLog( peripheral );

	    //処理対象だったのでリストに追加
	    _self.beaconList[ peripheral.address ] = peripheral;
	}

	//接続時
	this.ddbConnect = function(){
	    console.log('on -> connect');
	    //接続成功したら サービス列挙
	    this.discoverServices();	
	}

	//切断時
	this.ddbDisconnect = function(){
		console.log('on -> disconnect');
	}
	
	//Service毎のcharacteristicをdiscover実施
	this.ddbIncludedServicesDiscover = function(includedServiceUuids){
		//console.log("ddbIncludedServicesDiscover");
		//console.log('on -> service included services discovered ' + includedServiceUuids);
	    //Service毎のcharacteristicをdiscover実施
	    this.discoverCharacteristics();   
	}

	this.ddbCharacteristicsDiscover = function (peripheral,characteristics){
		//console.log("ddbCharacteristicsDiscover");
	    for(j = 0; j < characteristics.length; j++) {       
	    	//Service毎のcharacteristicを表示
	        //console.log('service_uuid ' + characteristics[j]._serviceUuid + ' characteristic[' + j + '] ' + characteristics[j]);
	    	var uuid = characteristics[j]['uuid'];
	    	//スイッチステータのUUIDだった場合
	    	if(uuid == _self.DOOR_DOOR_BEACON_CHARACTERISTIC_SWITCH_UUID){
	    		var switchCharacteristic = characteristics[j];
	    		//スイッチの値を読み込む
	    		var fnc = function(data, isNotification){
	    			_self.switchCharacteristicRead(peripheral,data, isNotification);
	    		};
	    		switchCharacteristic.on('read',fnc);
	    		switchCharacteristic.read();
	    	}
	    }
	}

	//サービス列挙後に ビーコンに接続して情報を取得する
	this.ddbServicesDiscover = function( services ){
		//console.log("ddbServicesDiscover");
		var peripheral = this;
		for(i = 0; i < services.length; i++) {
			//
	        services[i].on('includedServicesDiscover', _self.ddbIncludedServicesDiscover);
	        
	        //Service毎のcharacteristicを列挙
	        var fnc = function(characteristics){
	        	_self.ddbCharacteristicsDiscover(peripheral,characteristics);
	        };
	        services[i].on('characteristicsDiscover',fnc);
	        
	        services[i].discoverIncludedServices();
	    }
	}
	
	//Cron 処理　開始
	this.cronOnTick = function(){
		var length = Object.keys(_self.beaconList).length;
		console.log('onTick! '+(new Date()).getTime());	    
	    console.log(' length:'+length);	
	    
	    if( length > 0){
	    	for(address in _self.beaconList){
	    		if( _self.beaconList.hasOwnProperty(address) ) {
	    			//ビーコンに接続して状態を取得する
	    			_self.beaconList[address].connect();
	    		}
	    	}
	    }
	}
	
	//Cron 処理終了
	this.cronOnStop = function(){
		console.log('cronOnStop');		
	}
	
	//定期的に実行する処理
	this.job = new CronJob(_self.cronTime, _self.cronOnTick, _self.cronOnStop,false,"Asia/Tokyo");
	
	//json-serverを初期化
	this.initJsonServer = function(){
		_self.server.use(jsonServer.defaults);
		var router = jsonServer.router('db.json');
		_self.server.use(router);
		_self.server.listen(3000);
	}
	
	//スイッチのステータスを読み出す
	this.switchCharacteristicRead = function(peripheral,data,isNotification){
	    //console.log( "peripheral" );
	    //console.log( peripheral );
		
		var value = data.toString('hex');
	    console.log('Switch value:'+value);
	    //値が取れたのでバッテリー節約の為にここで切断する。
	    noble.disconnect( peripheral.uuid );
	    
	    //TODO Parse.com へ送信する
	    
	    //ローカルDBに保存してみる
	    var log = {address:peripheral.address,
	    			value:parseInt(value),
	    			createDate:(new Date()).getTime()
	    		};
	    _self.db('switch_log').push(log);
	}
}

exports.DoorDoorBeacon = new DoorDoorBeacon();