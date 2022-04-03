function genTitle() {

    var newDiv = document.createElement('div');
    newDiv.innerHTML = '<h1 contenteditable="true" class="text-center">Hello world!!!</h1>';
    const $colors = document.querySelector('#userSpace');
    $colors.appendChild(newDiv);
    document.getElementById("collapsed").hidden = true;
}

function genCover() {

    var newDiv = document.createElement('div');
    newDiv.innerHTML = '<article class="cover"><h4 contenteditable="true" class="cover__uptitle">your company</h4><h1 contenteditable="true" class="cover__title">Title/TagLine</h1><p contenteditable="true" class="cover__description">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Maecenas lobortis odio vel varius sollicitudin.</p></article>';
    const $colors = document.querySelector('#userSpace');
    $colors.appendChild(newDiv);
    document.getElementById("collapsed").hidden = true;
}

function savePage() {
    var userSource = document.getElementById("userSpace")
    var xmlHttpRequest = new XMLHttpRequest()
    var form = new FormData()
    var source = ""
    var url = ""

    if (userSource == null) { return; }

    url = document.documentURI

    url = url.slice(0, url.lastIndexOf("/")) + "/EditTemplatesPost"

    source = userSource.innerHTML

    form.append("html", source)

    xmlHttpRequest.open("POST", url)

    xmlHttpRequest.send(form)

    alert(xmlHttpRequest.status)

}