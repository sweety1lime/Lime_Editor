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

function updatePage() {
    console.log("freshawakado");
    var userSource = document.getElementById("userSpace")
    var xmlHttpRequest = new XMLHttpRequest()
    var form = new FormData()
    var source = ""
    var url = ""

    if (userSource == null) {
        console.log("adios bambinos");
        return;
    }

    url = "http://localhost:8000/Template/UpdateSitecheck"

    //url = url.slice(0, url.lastIndexOf("/")) + "/UpdateSitecheck"

    source = userSource.innerHTML

    form.append("html", source)

    xmlHttpRequest.open("POST", url)

    xmlHttpRequest.send(form)

    alert(xmlHttpRequest.status)

}

function changeName() {
    console.log("freshawakado");
    var userSource = document.getElementById("changeName")
    var xmlHttpRequest = new XMLHttpRequest()
    var form = new FormData()
    var source = ""
    var url = ""
    if (userSource == null) {
        console.log("adios bambinos");
        return;
    }

    url = "http://localhost:8000/Home/ChangeName"

    //url = url.slice(0, url.lastIndexOf("/")) + "/UpdateSitecheck"

    source = userSource.innerHTML

    form.append("html", source)

    xmlHttpRequest.open("POST", url)

    xmlHttpRequest.send(form)

    alert(xmlHttpRequest.status)
}