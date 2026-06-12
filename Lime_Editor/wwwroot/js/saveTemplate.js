function getCsrfToken() {
    var meta = document.querySelector('meta[name="X-CSRF-TOKEN"]');
    return meta ? meta.content : "";
}

function getTemplateId() {
    var meta = document.querySelector('meta[name="templateId"]');
    return meta ? meta.content : "";
}

function postWithToken(url, form) {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("X-CSRF-TOKEN", getCsrfToken());
    xhr.send(form);
    alert(xhr.status);
}

// Скачивание ZIP: ожидаем application/zip в ответе и сохраняем через blob+anchor.
function postAndDownload(url, form) {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("X-CSRF-TOKEN", getCsrfToken());
    xhr.responseType = "blob";
    xhr.onload = function () {
        if (xhr.status !== 200) {
            alert("Ошибка скачивания: " + xhr.status);
            return;
        }
        var fileName = parseFileName(xhr.getResponseHeader("Content-Disposition")) || "site.zip";
        var url = URL.createObjectURL(xhr.response);
        var a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };
    xhr.send(form);
}

function parseFileName(contentDisposition) {
    if (!contentDisposition) { return null; }
    var m = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(contentDisposition);
    return m ? decodeURIComponent(m[1]) : null;
}

function savPage() {
    var userSource = document.getElementById("userSpace");
    if (userSource == null) { return; }
    var form = new FormData();
    form.append("html", userSource.innerHTML);
    form.append("templateId", getTemplateId());
    postWithToken("/Home/SavetoUser", form);
}

function updatePage() {
    var userSource = document.getElementById("userSpace");
    if (userSource == null) { return; }
    var form = new FormData();
    form.append("html", userSource.innerHTML);
    postWithToken("/Template/UpdateSitecheck", form);
}

function changeName() {
    var userSource = document.getElementById("changeName");
    if (userSource == null) { return; }
    var form = new FormData();
    form.append("html", userSource.innerHTML);
    postWithToken("/Home/ChangeName", form);
}

// Единая кнопка "Скачать" для всех трёх шаблонов — раньше было три функции
// (downloadTemp/downloadSublime/downloadCommingSoon) под три эндпоинта.
function downloadSite() {
    var userSource = document.getElementById("userSpace");
    if (userSource == null) { return; }
    var del = document.getElementById("del"); if (del) del.remove();
    var del1 = document.getElementById("del1"); if (del1) del1.remove();
    var del2 = document.getElementById("del2"); if (del2) del2.remove();

    var form = new FormData();
    form.append("html", userSource.innerHTML);
    form.append("templateId", getTemplateId());
    postAndDownload("/Template/DownloadSite", form);
}
