function savPage() {
    var userSource = document.getElementById("userSpace")
    var xmlHttpRequest = new XMLHttpRequest()
    var form = new FormData()
    var source = ""
    var url = ""

    if (userSource == null) { return; }

    url = "http://localhost:8000/Home/SavetoUser"

    //url = url.slice(0, url.lastIndexOf("/")).slice(0, url.lastIndexOf("/")) + "/Home/SavetoUser"

    source = userSource.innerHTML

    form.append("html", source)

    xmlHttpRequest.open("POST", url)

    xmlHttpRequest.send(form)

    alert(xmlHttpRequest.status)

}

function freshawakady() {
    var userSource = document.getElementById("userSpace")
    var xmlHttpRequest = new XMLHttpRequest()
    var form = new FormData()
    var source = ""
    var url = ""

    if (userSource == null) { return; }

    url = "http://localhost:8000/Template/UpdateSite"

    //url = url.slice(0, url.lastIndexOf("/")).slice(0, url.lastIndexOf("/")) + "/Home/SavetoUser"

    source = userSource.innerHTML

    form.append("html", source)

    xmlHttpRequest.open("POST", url)

    xmlHttpRequest.send(form)

    alert(xmlHttpRequest.status)

}