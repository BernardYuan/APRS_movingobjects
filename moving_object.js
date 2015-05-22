var express = require('express');
var bodyParser=require("body-parser");
var http = require("http");
var path = require('path');
var net = require('net');
var fs=require('fs');
var app = express();
var logstream=fs.createWriteStream('test.log',{flags:'a'});  //the reports that are processed by the program
var otherstream=fs.createWriteStream('other.log',{flag:'a'}); //the reports should be processed by other programs
var exceptionstream=fs.createWriteStream('exception.log',{flag:'a'}); //exceptions, needing some further process

//display the latitude and longitude in the given format
function displayLat(lat)
{
    var lat_final, temp;

    lat_final = parseFloat(lat.substring(0, 2)); //degrees
    temp = parseFloat(lat.substring(2, lat.length-1));
    lat_final += temp/60.0;
    if (lat.charAt(lat.length-1) == "S")
        lat_final *= -1;

    return lat_final;
}
function displayLong(long)
{
    var long_final, temp;

    long_final = parseFloat(long.substring(0, 3)); //degrees
    temp = parseFloat(long.substring(3, long.length-1));
    long_final += temp/60.0;
    if (long.charAt(long.length-1) == "W")
        long_final *= -1;

    return long_final;
}
//for compressed data, decode the latitude and longitude
function decodeLat(lat)
{
    var lat_final = 90 - ((lat.charCodeAt(0)-33)*Math.pow(91, 3) + (lat.charCodeAt(1)-33)*Math.pow(91, 2) + (lat.charCodeAt(2)-33)*91 + lat.charCodeAt(3)-33) / 380926;
    return lat_final;
}

function decodeLong(long)
{
    var long_final = -180 + ((long.charCodeAt(0)-33)*Math.pow(91, 3) + (long.charCodeAt(1)-33)*Math.pow(91, 2) + (long.charCodeAt(2)-33)*91 + long.charCodeAt(3)-33) / 190463;
    return long_final;
}
//judge whether moving objects
function isMoving(symbol, dest_adr, src_adr)
{
    var moves = 0;
    if (symbol.charAt(0) == "/") //information field (mostly stations)
    {
        switch (symbol.charAt(1))
        {
            case "!": case "$": case "'": case "*": case ",": case "<": case ">": case "C":
            case "O": case "P": case "R": case "S": case "U": case "V": case "X": case "Y":
            case "[": case "^": case "a": case "b": case "e": case "f": case "g": case "j":
            case "k": case "p": case "s": case "u": case "v":case "\\": moves = 1;
            break;
            default: break;
        }
    }
    else if (symbol.charAt(0) == "\\") //information field (mostly Objects)
    {
        switch (symbol.charAt(1))
        {
            case ",": case ">": case "S": case "^": case "s": case "u": case "v": moves = 1;
            break;
            default: break;
        }
    }
    else // information address symbol
    {
        if ((dest_adr.substr(0, 3)).localeCompare("GPS") == 0) //destination address is valid
        {
            switch (dest_adr.slice(4))
            {
                case "BB": case "BE": case "BH": case "BK": case "BM": case "MT": case "MV": case "PC":
                case "OM": case "NV": case "PO": case "PP": case "PR": case "PS": case "PU": case "PV":
                case "PX": case "PY": case "HS": case "HV": case "LA": case "LB": case "LE": case "LF":
                case "AS": case "DV": case "LG": case "LJ": case "LK": case "LP": case "LS": case "LU":
                case "LV": case "SS": case "SU": case "SV": case "01": case "04": case "07": case "10":
                case "12": case "28": case "30": case "35": case "47": case "48": case "50": case "51":
                case "53": case "54": case "56": case "57": case "59": case "62": case "65": case "66":
                case "69": case "70": case "71": case "74": case "75": case "80": case "83": case "85":
                case "86": moves = 1;
                    break;
                default: break;
            }
        }
        else //SSID
        {
            var temp = src_adr.indexOf("-");
            src_adr = src_adr.slice(temp); //get SSID (-XXX)
            switch (src_adr)
            {
                case "-0": case "-1": case "-2": case "-3": case "-4": case "-5": case "-6": case "-7":
                case "-8": case "-9": case "-10": case "-11": case "-12": case "-13": case "-14": case "-15": moves = 1;
                break;
                default: moves = -1; break; //unknown object
            }
        }
    }
    return moves;
}

function setSymbol(obj, symbol, dest_adr) {
    if (symbol.charAt(1).match(/[\w\*!#\$%\^&\*\)\+,-\./;<>=\?']/)) { //information field
        obj["Symbol"] = symbol;
        if (symbol.charAt(0) != '/' && symbol.charAt(0) != '\\' && symbol.charAt(1).match(/[#&0>A\^acnsuvz]/)) //has overlay
            obj["Overlay"] = symbol.charAt(0);
    }
    else if ((dest_adr.substr(0, 3)).localeCompare("GPS") == 0) { //destination address is valid
        obj["Symbol"] = dest_adr.substr(0, dest_adr.length);
        if (dest_adr.slice(3, 5).match(/[A-Z][A-Z0-9]/) && dest_adr.charAt(5) != ' ') //has overlay
            obj["Overlay"] = dest_adr.charAt(5);
    }
    else obj["Symbol"] = "";
}

function getTime(time){
    var d = new Date();
    var s;
    if (time.charAt(6)=="z"){
        d.setUTCDate(parseInt(time.substring(0,2)));
        d.setUTCHours(parseInt(time.substring(2,4)));
        d.setUTCMinutes(parseInt(time.substring(4,6)));
        s = d.toUTCString();
    }
    else if (time.charAt(6)=="h"){
        d.setUTCHours(parseInt(time.substring(0,2)));
        d.setUTCMinutes(parseInt(time.substring(2,4)));
        d.setUTCSeconds(parseInt(time.substring(4,6)));
        s = d.toUTCString();
    }
    return (s);
}
function decodeCourse(c){
    var course_final = (c.charCode-33) * 4;
    return course_final;
}

function decodeSpeed(s){
    var speed_final = Math.pow(1.08,(s.charCode-33))-1;
    return speed_final;
}

function decodeAltitude(c, s) {
    var alt = Math.pow(1.002, ((c.charCode-33)*91 + parseInt(s.charCode)));
    return alt;
}

function decodeType(type) {
    var T;

    switch (type) { //type of shape
        case '0': T = "Circle"; break;
        case '1': T = "Line"; break;
        case '2': T = "Ellipse"; break;
        case '3': T = "Triangle"; break;
        case '4': T = "Box"; break;
        case '5': T = "Colour-filled circle"; break;
        case '6': T = "Line"; xx *= -1; break;
        case '7': T = "Colour-filled ellipse"; break;
        case '8': T = "Colour-filled triangle"; break;
        case '9': T = "Colour-filled box"; break;
        default: T = ""; break;
    }

    return T;
}

function decodeColour(colour) {
    var C;
    switch (colour) { //colour
        case "/0": C = "Black-High"; break;
        case "/1": C = "Blue-High"; break;
        case "/2": C = "Green-High"; break;
        case "/3": C = "Cyan-High"; break;
        case "/4": C = "Red-High"; break;
        case "/5": C = "Violet-High"; break;
        case "/6": C = "Yellow-High"; break;
        case "/7": C = "Gray-High"; break;
        case "/8": C = "Black-Low"; break;
        case "/9": C = "Blue-Low"; break;
        case "10": C = "Green-Low"; break;
        case "11": C = "Cyan-Low"; break;
        case "12": C = "Red-Low"; break;
        case "13": C = "Violet-Low"; break;
        case "14": C = "Yellow-Low"; break;
        case "15": C = "Gray-Low"; break;
    }
    return C;
}
function SendtoDB(object){
    var req=http.request({
        hostname:"localhost",
        port:3000,
        method:"post",
        path:"/moving_object",
        headers:{
            'Content-Type':"application/json"
        }
    },function(res){
       console.log("Sent");
    });
    req.write(JSON.stringify(object));
    req.end();
}
// view engine setup

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');
app.use(bodyParser.json({
    extended: true
}));
app.post('/moving_obj' +
'ect',function(q,res){
    console.log(q.body);
    res.send("received");
});
app.listen(3000,function(){
    console.log("listening port 3000");
});

var buf=new Buffer("user BG5ZZZ-85 pass 24229 ver MY185\n#filter t/poi\n");

var conn=net.connect({port:14580,host:'hangzhou.aprs2.net'},function() {
    conn.setNoDelay();
    console.log("connection to server!");
    //console.log(conn);
    conn.write(buf);
});



//socket.on('connect',function(){
conn.on("error",function(err){
    console.log(err.message);
});
    /*
    socket.on('data',function(data){
        console.log(data.toString());
    });

    socket.write('user BG5ZZZ-85 pass -24229 ver MY185',"utf8",function() {
        console.log("sent verification");
    });*/
    //});

//conn.write("user BG5ZZZ-85 pass 24229 ver MY185");
conn.on('data',function(data){
    var array=data.toString().split('\r\n');
    var i=0;
    for(i=0;i<array.length-1;i++) {
        var object={};
        var com_obj={};
        var symbol="";
        var message="";
        var c="";
        var s="";
        var header=array[i].split(':')[0];
        var info=array[i].slice(header.length+1);
        if(header&&info) {
            object["Source"] = header.split('>')[0]; //source of the report
            //if (header.split('>')[1])
            object["Destination"] = header.split('>')[1].split(',')[0];  //destination of the report
            if (info[0] == '!' || info[0] == '=') { //without Timestamp
                object["Time"]=new Date();
                object["Time"]=object["Time"].toUTCString();
                if (info[1] != '/') {//uncompressed
                    object["Latitude"] = displayLat(info.slice(1, 9));
                    object["Longitude"] = displayLong(info.slice(10, 19));
                    symbol = info.charAt(9) + info.charAt(19);
                    com_obj["Comment"] = info.slice(20);
                    if (symbol == "/\\") { //deal with the course/speed BRG and RNQ
                        object["Course"] = parseInt(info.slice(20, 23));
                        object["Speed"] = parseInt(info.slice(24, 27));
                        com_obj["BRG"] = parseInt(info.slice(28, 31));
                        com_obj["NRQ"] = parseInt(info.slice(32, 35));
                        com_obj["Comment"] = info.slice(35);
                    } else {  //no BRG and NRQ
                        message = info.slice(20, 36);
                        if (message.match(/[0-9][0-9][0-9]\/[0-9][0-9][0-9]\/A=[-0-9][0-9][0-9][0-9][0-9][0-9]/)) {
                            object["Course"] = parseInt(message.slice(0, 3));
                            object["Speed"] = parseInt(message.slice(4, 7));
                            object["Altitude"] = parseInt(message.slice(10));
                            com_obj["Comment"] = info.slice(36);
                        } else if (message.match(/[0-9][0-9][0-9]\/[0-9][0-9][0-9]/)) {
                            object["Course"] = parseInt(message.slice(0, 3));
                            object["Speed"] = parseInt(message.slice(4, 7));
                            com_obj["Comment"] = info.slice(27);
                        } else if (message.match(/A=[-0-9][0-9][0-9][0-9][0-9][0-9]/)) {
                            object["Altitude"] = parseInt(message.slice(3, 9));
                            com_obj["Comment"] = info.slice(29);
                        } else {
                            com_obj["Comment"] = info.slice(20);
                        }
                    }
                } else { //compressed data
                    object["Latitude"] = decodeLat(info.slice(2, 6));
                    object["Longitude"] = decodeLong(info.slice(6, 10));
                    symbol = info.charAt(1) + info.charAt(10);
                    c = info.charAt(11);
                    s = info.charAt(12);
                    com_obj["Compression Type"] = info.charAt(13);
                    com_obj["Comment"] = info.slice(14);
                    if (c.charCode >= 0 && c.charCode <= 89) {
                        object["Course"] = decodeCourse(c);
                        object["Speed"] = decodeSpeed(s);
                    }
                    if (c != ' ' && ((com_obj["Compression Type"].charCode - 33) % 32 >= 16 && (com_obj["Compression Type"].charCode - 33) % 32 <= 23)) {
                        object["Altitude"] = decodeAltitude(c, s);
                    }
                }
                if (symbol.localeCompare("/_") != false) //not weather or Mic-E data
                {
                    if(object["Destination"]) setSymbol(com_obj, symbol, object["Destination"]);
                    //console.log(com_obj);
                    object["Comment"] = JSON.stringify(com_obj);
                    logstream.write(Date().toString() + ":" + array[i] + "\n");
                    logstream.write(JSON.stringify(object) + '\n');
                    SendtoDB(object);
                    //console.log(object);
                } else {
                    otherstream.write(Date().toString() + ':' + array[i] + '\n');
                }
            } else if (info[0] == '/' || info[0] == '@') {
                if (info[8] != '/') {
                    object["Time"] = getTime(info.slice(1, 8));
                    object["Latitude"] = displayLat(info.slice(8, 16));
                    object["Longitude"] = displayLong(info.slice(17, 26));
                    symbol = info.charAt(16) + info.charAt(26);
                    com_obj["Comment"] = info.slice(27);
                    if (symbol == "/\\") { //deal with the course/speed BRG and RNQ
                        object["Course"] = parseInt(info.slice(27, 30));
                        object["Speed"] = parseInt(info.slice(31, 34));
                        com_obj["BRG"] = parseInt(info.slice(35, 38));
                        com_obj["NRQ"] = parseInt(info.slice(39, 42));
                        com_obj["Comment"] = info.slice(42);
                    } else {
                        message = info.slice(27, 43);
                        if (message.match(/[0-9][0-9][0-9]\/[0-9][0-9][0-9]\/A=[-0-9][0-9][0-9][0-9][0-9][0-9]/)) {
                            object["Course"] = parseInt(message.slice(0, 3));
                            object["Speed"] = parseInt(message.slice(4, 7));
                            object["Altitude"] = parseInt(message.slice(10));
                            com_obj["Comment"] = info.slice(43);
                        } else if (message.match(/[0-9][0-9][0-9]\/[0-9][0-9][0-9]/)) {
                            object["Course"] = parseInt(message.slice(0, 3));
                            object["Speed"] = parseInt(message.slice(4, 7));
                            com_obj["Comment"] = info.slice(34);
                        } else if (message.match(/A=[-0-9][0-9][0-9][0-9][0-9][0-9]/)) {
                            object["Altitude"] = parseInt(message.slice(3, 9));
                            com_obj["Comment"] = info.slice(36);
                        } else {
                            com_obj["Comment"] = info.slice(27);
                        }
                    }
                } else {  //compressed data
                    object["Time"] = getTime(info.slice(1, 8));
                    object["Latitude"] = decodeLat(info.slice(9, 13));
                    object["Longitude"] = decodeLong(info.slice(13, 17));
                    symbol = info.charAt(8) + info.charAt(17);
                    c = info.charAt(18);
                    s = info.charAt(19);
                    com_obj["Compression Type"] = info.charAt(20);
                    com_obj["Comment"] = info.slice(21);
                    if (c.charCode >= 0 && c.charCode <= 89) {
                        object["Course"] = decodeCourse(c);
                        object["Speed"] = decodeSpeed(s);
                    }
                    if (c != ' ' && ((com_obj["Compression Type"].charCode - 33) % 32 >= 16 && (com_obj["Compression Type"].charCode - 33) % 32 <= 23)) {
                        object["Altitude"] = decodeAltitude(c, s);
                    }
                }
                if (symbol.localeCompare("/_") != false) //not weather or Mic-E data
                {
                    if(object["Destination"]) setSymbol(com_obj, symbol, object["Destination"]);
                    object["Comment"] = JSON.stringify(com_obj);
                    logstream.write(Date().toString() + ":" + array[i] + "\n");
                    logstream.write(JSON.stringify(object) + '\n');
                    SendtoDB(object);
                } else {
                    otherstream.write(Date().toString() + ':' + array[i] + '\n');
                }
            } else if (info[0] == ';') { //object
                if (info[18] != '/') { //non-compressed
                    object["Name"] = info.slice(1, 10);
                    object["Time"] = getTime(info.slice(11, 18));
                    object["Latitude"] = displayLat(info.slice(18, 26));
                    object["Longitude"] = displayLong(info.slice(27, 36));
                    symbol = info.charAt(26) + info.charAt(36);
                    com_obj["Comment"] = info.slice(37);
                    if (info.charAt(10) == '*')
                        com_obj["isLive"] = 1;
                    else if (info.charAt(10) == '_')
                        com_obj["isLive"] = 0;
                    else com_obj["isLive"] = -1;
                    if (symbol.localeCompare("\\l") == 0) { //area object
                        com_obj["Shape"] = decodeType(info.charAt(37));
                        com_obj["Lat Offset"] = parseInt(info.slice(38, 40));
                        com_obj["Colour"] = decodeColour(info.slice(40, 42));
                        com_obj["Long Offset"] = (info.charAt(37) == '6' ? parseInt(info.slice(42, 44)) * -1 : parseInt(info.slice(42, 44)));
                        object["Comment"] = info.slice(44);
                    } else if (symbol.localeCompare("\\m") == 0) { //signpost object
                        com_obj["Signpost"] = info.slice(37, info.indexOf('}') + 1);
                        com_obj["Comment"] = info.slice(info.indexOf('}') + 1);
                    }
                    message = info.slice(37, 53);
                    if (message.match(/[0-9][0-9][0-9]\/[0-9][0-9][0-9]\/A=[-0-9][0-9][0-9][0-9][0-9][0-9]/)) {
                        object["Course"] = parseInt(message.slice(0, 3));
                        object["Speed"] = parseInt(message.slice(4, 7));
                        object["Altitude"] = parseInt(message.slice(10));
                        com_obj["Comment"] = info.slice(53);
                    } else if (message.match(/[0-9][0-9][0-9]\/[0-9][0-9][0-9]/)) {
                        object["Course"] = parseInt(message.slice(0, 3));
                        object["Speed"] = parseInt(message.slice(4, 7));
                        com_obj["Comment"] = info.slice(44);
                    } else if (message.match(/A=[-0-9][0-9][0-9][0-9][0-9][0-9]/)) {
                        object["Altitude"] = parseInt(message.slice(3, 9));
                        com_obj["Comment"] = info.slice(46);
                    } else {
                        com_obj["Comment"] = info.slice(37);
                    }
                } else { //compressed
                    object["Name"] = info.slice(1, 10);
                    object["Time"] = getTime(info.slice(11, 18));
                    object["Latitude"] = decodeLat(info.slice(19, 23));
                    object["Longitude"] = decodeLong(info.slice(23, 27));
                    symbol = info.charAt(18) + info.charAt(27);
                    c = info.charAt(28);
                    s = info.charAt(29);
                    com_obj["Compression Type"] = info.charAt(30);
                    if (c != ' ' && ((com_obj["Compression Type"].charCode - 33) % 32 >= 16 && (com_obj["Compression Type"].charCode - 33) % 32 <= 23)) {
                        object["Altitude"] = decodeAltitude(c, s);
                    } else if (c.charCode >= 0 && c.charCode <= 89) {
                        object["Course"] = decodeCourse(c);
                        object["Speed"] = decodeSpeed(s);
                    }
                    com_obj["Comment"] = info.slice(30);
                }
                if (symbol.localeCompare("/_") != false) //not weather or Mic-E data
                {
                    if(object["Destination"]) setSymbol(com_obj, symbol, object["Destination"]);
                    //console.log(com_obj);
                    object["Comment"] = JSON.stringify(com_obj);
                    logstream.write(Date().toString() + ":" + array[i] + "\n");
                    logstream.write(JSON.stringify(object) + '\n');
                    SendtoDB(object);
                    //console.log(object);
                } else {
                    otherstream.write(Date().toString() + ':' + array[i] + '\n');
                }
            } else if (info.charAt(0) == ')') { //item
                var item_front = info.split('!' || '_')[0];
                var item_back = info.slice(item_front.length);
                if (item_back[1] != '/') { //non-compressed
                    if (item_back.charAt(0) == '!')
                        com_obj["isLive"] = 1;
                    else
                        com_obj["isLive"] = 0;
                    object["Latitude"] = displayLat(item_back.slice(1, 9));
                    object["Longitude"] = displayLong(item_back.slice(10, 19));
                    object["Name"] = item_front.slice(1);
                    symbol = item_back.charAt(9) + item_back.charAt(19);
                    if (symbol.localeCompare("\\m") == 0) {
                        com_obj["Signpost"] = item_back.slice(21, item_back.indexOf('}'))
                        com_obj["Comment"] = item_back.slice(item_back.indexOf('}') + 1);
                    }
                    message = item_back.slice(20, 36);
                    if (message.match(/[0-9][0-9][0-9]\/[0-9][0-9][0-9]\/A=[-0-9][0-9][0-9][0-9][0-9][0-9]/)) {
                        object["Course"] = parseInt(message.slice(0, 3));
                        object["Speed"] = parseInt(message.slice(4, 7));
                        object["Altitude"] = parseInt(message.slice(10));
                        com_obj["Comment"] = item_back.slice(36);
                    } else if (message.match(/[0-9][0-9][0-9]\/[0-9][0-9][0-9]/)) {
                        object["Course"] = parseInt(message.slice(0, 3));
                        object["Speed"] = parseInt(message.slice(4, 7));
                        com_obj["Comment"] = item_back.slice(27);
                    } else if (message.match(/A=[-0-9][0-9][0-9][0-9][0-9][0-9]/)) {
                        object["Altitude"] = parseInt(message.slice(3, 9));
                        com_obj["Comment"] = info.slice(29);
                    } else
                        com_obj["Comment"] = item_back.slice(20);
                } else { //compressed
                    if (item_back.charAt(0) == '!')
                        com_obj["isLive"] = 1;
                    else
                        com_obj["isLive"] = 0;

                    object["Latitude"] = decodeLat(item_back.slice(2, 6));
                    object["Longitude"] = decodeLong(info.slice(6, 10));
                    object["Name"] = item_front.slice(1);
                    symbol = item_back.charAt(1) + item_back.charAt(10);
                    c = item_back.charAt(11);
                    s = item_back.charAt(12);
                    com_obj["Compression Type"] = item_back.charAt(13);
                    if (c != ' ' && ((com_obj["Compression Type"].charCode - 33) % 32 >= 16 && (com_obj["Compression Type"].charCode - 33) % 32 <= 23)) {
                        object["Altitude"] = decodeAltitude(c, s);
                    } else if (c.charCode >= 0 && c.charCode <= 89) {
                        object["Course"] = decodeCourse(c);
                        object["Speed"] = decodeSpeed(s);
                    }
                    com_obj["Comment"] = item_back.slice(14);
                }
                if (symbol.localeCompare("/_") != false) //not weather or Mic-E data
                {
                    if(object["Destination"]) setSymbol(com_obj, symbol, object["Destination"]);
                    //console.log(com_obj);
                    object["Comment"] = JSON.stringify(com_obj);
                    logstream.write(Date().toString() + ":" + array[i] + "\n");
                    logstream.write(JSON.stringify(object) + '\n');
                    SendtoDB(object);
                    //console.log(object);
                } else {
                    otherstream.write(Date().toString() + ':' + array[i] + '\n');
                }
            }
            else {
             if(info[0]=="'"||info[0]=='`') otherstream.write(Date().toString()+':'+array[i]+'\n');
             else exceptionstream.write(Date().toString()+':'+array[i]+'\n');
             }
        }
    }
});





