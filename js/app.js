;$(function() {
    var ranked_sentences;
    var active_edit;
    var slop = 2;
    var cc_offset = 0;

    function getProgid(url,callback){
        var flproxy = new flensed.flXHR({ xmlResponseText:false, onerror:handleError, onreadystatechange:handleLoading, noCacheHeader:false, loadPolicyURL:"http://www.c-span.org/crossdomain.xml" });

        function handleLoading(XHRobj) {
            if (XHRobj.readyState == 4) {
                callback(XHRobj.responseText.slice(XHRobj.responseText.indexOf("data-progid")+13).split("'")[0]);
            }
        }

        function handleError(errObj) {
            console.log(errObj);
        }

        flproxy.open("GET",url);
        flproxy.send();
    }

    function getSrcURLs(progid,callback){
        var flproxy = new flensed.flXHR({ xmlResponseText:false, onerror:handleError, onreadystatechange:handleLoading, noCacheHeader:false, loadPolicyURL:"http://www.c-span.org/crossdomain.xml" });

        function handleLoading(XHRobj) {
            if (XHRobj.readyState == 4) {
                var foo = JSON.parse(XHRobj.responseText);
                console.log(foo);
                var escapedVidUrl = foo.video.files[0].path["#text"].replace(/&amp;/g,"&");
                callback(escapedVidUrl,foo.video.capfile["#text"]);
            }
        }

        function handleError(errObj) {
            console.log(errObj);
        }

        flproxy.open("GET","http://www.c-span.org/assets/player/ajax-player.php");
        var request = "os=html&html5=program&id="+progid;
        flproxy.send(request);

    }

    function getSubs(url,callback){
        var flproxy = new flensed.flXHR({ xmlResponseText:true, onerror:handleError, onreadystatechange:handleLoading, noCacheHeader:false, loadPolicyURL:"http://data.c-spanvideo.org.s3.amazonaws.com/crossdomain.xml" });

        function handleLoading(XHRobj) {
            if (XHRobj.readyState == 4) {
                window.foo = XHRobj.responseXML;
                var subs = Array.prototype.map.call(
                        XHRobj.responseXML.getElementsByTagName("p"),function(p) {
                            var text = "";
                            if (p.childNodes.length>0) {
                                text = p.childNodes[p.childNodes.length-1].data;
                            }
                            return { begin: parseFloat(p.attributes.begin.value),
                                     end: parseFloat(p.attributes.end.value),
                                     text: text }
                        });
                callback(subs);
            }
        }

        function handleError(errObj) {
            console.log(errObj);
        }

        flproxy.open("GET",url);
        flproxy.send();

    }

    function subsToSentences(subs) {
        var running_line = "";
        var atoms = subs.map(function(s) {
            var out = {begin: s.begin, end: s.end};
            if (s.text.indexOf(running_line)===0) {
                out.text = s.text.slice(running_line.length);
            } else {
                out.text = s.text;
            }
            running_line = s.text;
            return out;
        });
        var sentences = [];
        var current_sentence = false;
        atoms.forEach(function(a) {
            a.text.split(/\b/).forEach(function(w) {
                if (w.match(/\w/)) {
                    if (current_sentence) {
                        current_sentence.end = a.end;
                        current_sentence.words.push(w);
                    } else {
                        current_sentence = {
                            begin: a.begin,
                            end: a.end,
                            words: [w]
                        };
                    }
                } else if (w.match(/[!?.]/)) {
                    if (current_sentence) {
                        var lw = current_sentence.words[current_sentence.words.length-1];
                        if (lw==="MR" || lw==="MS" || lw==="MRS" || lw.length===1) {
                            return;
                        }
                        sentences.push(current_sentence);
                    }
                    current_sentence = false;
                }
            });
        });
        if (current_sentence) {
            sentences.push(current_sentence);
        }
        return sentences;
    }

    function setStatus(status) {
        $("#status").html(status);
    }

    function groomEdit(e) {
        e = e.map(function(d) {
            return {begin:Math.max(0,d.begin-cc_offset-slop), end:d.end-cc_offset+slop}
        });
        e.sort(function(a,b) { return a.begin-b.begin; });
        var out = [];
        for (var i=0;i<e.length;i++) {
            if (out.length===0 || e[i].begin>out[out.length-1].end) {
                out.push({begin: e[i].begin, end: e[i].end});
            } else if (e[i].end > out[out.length-1].end) {
                out[out.length-1].end = e[i].end;
            }
        }
        return out;
    }

    // TODO: Handle videos longer than 1hr
    // function VideoHandler(vid) {

    //     return {
    //         getTime: function() {
    //             return 5;
    //         },
    //         setTime: function(t) {

    //         }
    //     }
    // }

    function playEdit(e) {
        active_edit = groomEdit(e);
        var vid = $("#vid").get(0)
        vid.currentTime = active_edit[0].begin;
        vid.play();
        console.log("Playing from ", active_edit[0].begin);
    }

    function checkTime() {
        var ct = this.currentTime;
        for (var i = 0;i<active_edit.length;i++) {
            if (ct<active_edit[i].begin) {
                this.currentTime = active_edit[i].begin;
                console.log("Jumping to ", active_edit[i].begin, " from ", this.currentTime);
            }
            if (ct<active_edit[i].end) {
                break;
            }
        }
        if (ct>active_edit[active_edit.length-1].end) {
            console.log("Pausing: ", ct,active_edit[active_edit.length-1].end);
            this.pause();
        }
    }

    var subs;

    $("#urlGo").on("click", urlGo);
    function urlGo() {
        var url = $("#url").val();
        setStatus("getting progid");
        getProgid(url,
            function(progid) {
                setStatus("getting urls");
                getSrcURLs(progid,function(a,b) {
                    $("#vid").attr("src",a).load().on("timeupdate",checkTime);
                    setStatus("getting subs");
                    getSubs(b,function(s) {
                        subs = s;
                        setTimeout(doStuff,0);
                    });
                });
            });
    }

    function doStuff() {
        var sentences = subsToSentences(subs);
        ranked_sentences = rankSentences(sentences);
        setStatus("loaded");
        $("#edit-controls").show();
    }

    function rankSentences(sentences) {
        setStatus("ranking sentences");
        var graph = Summarizer.Utility.makeGraph(sentences);
        var configObj = {
                            "maxIter": 100,
                            "dampingFactor": 0.85,
                            "delta": 0.5
                        };
        return Summarizer.Utility.calculatePageRank(graph, configObj.maxIter,
                        configObj.dampingFactor, configObj.delta);
    }


    $("#editGo").on("click", editGo);
    function editGo() {
        var len =  $("#edit-length").val();
        makeEdit(len);
    }

    function makeEdit(len) {
        setStatus("processing");

        var totalTime = 0;
        var edit = [];
        for (var i=0;i<ranked_sentences.length;i++) {
            if (totalTime > len) {
                break;
            }
            var s = ranked_sentences[i].sentence;
            edit.push(s);
            totalTime += s.end - s.begin;
        }
        edit.sort(function(a,b) { return a.begin-b.begin; });
        $("#panel").empty();
        edit.forEach(function(s) {
            $("#panel").append($("<div>"+s.words.join(" ")+".</div>"));
        });
        setStatus("playing");
        playEdit(edit)
    }
});