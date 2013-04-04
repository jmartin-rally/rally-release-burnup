Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    version: "0.1",
    defaults: { margin: 5 },
    items: [{xtype:'container',itemId:'selector_box'},{xtype:'container',itemId:'chart_box'}],
    selected_release: null,
    items_in_release: [],
    launch: function() {
        this._addTimeboxSelector();
    },
    _addTimeboxSelector: function() {
        this.down('#selector_box').add({
            xtype:'rallyreleasecombobox',
            itemId:'release_box',
            listeners: {
                change: function(rb,newValue,oldValue) {
                    this.selected_release = rb.getRecord();
                    this._getScopedReleases();
                },
                ready: function(rb) {
                    this.selected_release = rb.getRecord();
                    this._getScopedReleases();
                },
                scope: this
            }
        });
    },
    _getScopedReleases: function() {
        var me = this;
        this.release_oids = [];
        if(this.chart){this.chart.destroy();}
        Ext.create('Rally.data.WsapiDataStore',{
            model: 'Release',
            autoLoad: true,
            filters: {property:'Name',value:me.selected_release.get('Name')},
            listeners: {
                load: function(store,data,success){
                    Ext.Array.each(data,function(item){
                        me.release_oids.push(item.get('ObjectID'));
                    });
                    me._getIterationsInRange(me.selected_release.get('ReleaseStartDate'),me.selected_release.get('ReleaseDate'));
                }
            }
        });
    },
    _getIterationsInRange: function(start_date, end_date){
        var me = this;
        this.iterations = {};
        var start_date_iso = Rally.util.DateTime.toIsoString(start_date);
        var end_date_iso = Rally.util.DateTime.toIsoString(end_date);
        var start_filter = Ext.create('Rally.data.QueryFilter',{property:'StartDate',operator:'>=',value:start_date_iso}).and(
            Ext.create('Rally.data.QueryFilter',{property:'StartDate',operator:'<=',value:end_date_iso}));
        var end_filter = Ext.create('Rally.data.QueryFilter',{property:'EndDate',operator:'>=',value:start_date_iso}).and(
            Ext.create('Rally.data.QueryFilter',{property:'EndDate',operator:'<=',value:end_date_iso}));

        var filters = start_filter.or(end_filter);
        Ext.create('Rally.data.WsapiDataStore',{
            model: 'Iteration',
            autoLoad: true,
            filters: filters,
            listeners: {
                load: function(store,data,success){
                    Ext.Array.each(data,function(item){
                        if (!me.iterations[item.get('Name')]) {
                            me.iterations[item.get('Name')] = [];
                        }
                        me.iterations[item.get('Name')].push(item);
                    });
                    me._getItemsInRelease();
                },
                scope: this
            }
        });
    },
    _getItemsInRelease: function() {
        window.console && console.log("_getItemsInRelease");
        var me = this;
        this.item_store = Ext.create('Rally.data.WsapiDataStore',{
            model: 'UserStory',
            autoLoad: true,
            filters: {property:'Release.Name',operator:'=',value:me.selected_release.get('Name')},
            fetch:['PlanEstimate','ScheduleState','Iteration','Name'],
            listeners: {
                load: function(store,data,success){
                    this.items_in_release = data;
                    this._makeIterationSlices();
                },
                scope: this
            }
        });
    },
    _getEndDates: function(iteration_hash) {
        var date_array = [];
        for (var i in iteration_hash ) {
            if ( iteration_hash.hasOwnProperty(i) ) {
                date_array.push(iteration_hash[i][0].get('EndDate'));
            }
        }
        return date_array;
    },
    _makeIterationSlices: function() {
        window.console && console.log( "_makeIterationSlices");
        var data_hash = {}; // key will be name
        for ( var name in this.iterations ) {
            var end_date = this.iterations[name][0].get('EndDate');
            var start_date = this.iterations[name][0].get('StartDate');
            data_hash[name] = Ext.create('Rally.pxs.data.IterationDataModel', { 
                Name: name, 
                IsoEndDate: end_date,
                IsoStartDate: start_date
            });
        }
        // add points from stories
        if ( this.items_in_release.length === 0 ) {
            this.chart = this.down('#chart_box').add({xtype:'container',html:'No data found.'});
        } else {
            Ext.Array.each(this.items_in_release,function(record){
                if ( record.get('Iteration') ) {
                    var sprint = record.get('Iteration').Name;
                   
                    if ( data_hash[sprint] ) {
                        data_hash[sprint].addScheduledItem(record.getData());
                    } else { 
                        window.console && console.log("WARNING: Iteration not defined",sprint);
                    }
                } else {
                    window.console && console.log("WARNING: Item not in sprint", record );
                }
            });
            data_hash = this._calculateCumulativeData(data_hash);
            this._showChart(data_hash);
        }
    },
    _calculateCumulativeData: function(data_hash) {
        var total_points = 0;
        var total_accepted = 0;
        for ( var sprint in data_hash ) {
            if ( data_hash.hasOwnProperty(sprint) ) {
                total_points += data_hash[sprint].get('PointsPlanned');
                total_accepted += data_hash[sprint].get('PointsAccepted');
                data_hash[sprint].set('CumulativePointsPlanned', total_points);
                data_hash[sprint].set('CumulativePointsAccepted', total_accepted);
            }
        }
        return data_hash;
    },
    _getCurrentSprintIndex: function(data_array) {
        var index = -1;
        Ext.Array.each(data_array, function(sprint,counter) {
            if(sprint && sprint.TemporalState === "Current" ) {
                index = counter;
            }
        });
        return index;
    },
    _showChart: function(data_hash){
        window.console && console.log("_showChart");
        var data_array = this._hashToArray(data_hash);
        var scope = data_array[data_array.length-1].CumulativePointsPlanned;
        var current_sprint_index = this._getCurrentSprintIndex(data_array);

        var chart_store = Ext.create('Ext.data.Store',{
            autoLoad: true,
            data: {data:data_array},
            model: 'Rally.pxs.data.IterationDataModel',
            proxy: {type: 'memory',reader: { type:'json',root:'data' } }
        });
        if(this.chart){this.chart.destroy();}
        this.chart = Ext.create('Rally.ui.chart.Chart',{
            height: 400,
            store: chart_store,
            series: [
                {type:'line',dataIndex:'CumulativePointsPlanned',name:'User Stories',visible:true},
                {type:'line',dataIndex:'CumulativePointsAccepted',name:'Stories Accepted',visible:true} ],
            chartConfig: {
                title: {text:'Program Burn Up',align:'center'},
                colors: ['#696','#00f'],
                xAxis: {
                    categories: this._getIterationNames(data_array),
                    plotLines: [{color:'#000',width:2,value:current_sprint_index}]
                },
                yAxis: [{
                    title: { text:"" },
                    plotLines: [
                        {color:'#000',width:2,value:0},
                        {color:'#f00',width:2,value:scope}
                    ]
                }]
            }
        });
        this.down('#chart_box').add(this.chart);
    },
    _getIterationNames: function(object_array) {
        var string_array = [];
        Ext.Array.each( object_array, function(item){
            string_array.push(item.Name);
        });
        return string_array;
    },
    _hashToArray: function(hash) {
        var the_array = [];
        var today = Rally.util.DateTime.toIsoString(new Date(),false).replace(/T.*$/,"");
        for (var key in hash ) {
            if (hash.hasOwnProperty(key)){
//                var snap = hash[key];
//                if ( key > today ) {
//                    snap.set('Future',true);
//                }
                // not sure why the model can't be pushed straight into the store
                the_array.push(hash[key].getData());
            }
        }
        return the_array;
    }
    
});
