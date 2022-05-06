const { hidden } = require("modernizr");

var oDoc, sDefTxt;

function initDoc() {
    oDoc = document.getElementById("textBox");
    sDefTxt = oDoc.innerHTML;
    if (document.compForm.switchBox.checked) { setDocMode(true); }
}

function formatDoc(sCmd, sValue) {
    if (validateMode()) { document.execCommand(sCmd, false, sValue); oDoc.focus(); }
}

function validateMode() {
    if (!document.compForm.switchBox.checked) { return true; }
    alert("Uncheck \"Показать HTML\"."); /* убрать галочку из "Показать HTML" */
   
    oDoc.focus();
    return false;
}

function setDocMode() {

    var editor = document.getElementById("userSpace");
    var editorContinue = document.getElementById("userSpaceContinue");
    var textBox = document.getElementById("textBox");
    var html = "";

    if (editor == null) {
        alert("Not found userSpace");
        return;
    }

    if (editorContinue == null) {
        alert("Not found userSpaceContinue");
        return;
    }

    if (textBox == null) {
        alert("Not found textBox");
        return;
    }

    html = textBox.innerHTML;
    html += editorContinue.innerHTML;
    //alert(html)
    editor.innerHTML = html;
    editorContinue.innerHTML = "";
    document.getElementById("boom").hidden = true;

    //alert(html)
    //html = textBox.innerHTML;
    //editor.innerHTML = html;
    /*
        var oContent;
        if (bToSource) {
            oContent = document.createTextNode(oDoc.innerHTML);
            oDoc.innerHTML = "";
            var oPre = document.createElement("pre");
            oDoc.contentEditable = false;
            oPre.id = "sourceText";
            oPre.contentEditable = true;
            oPre.appendChild(oContent);
            oDoc.appendChild(oPre);
            document.execCommand("defaultParagraphSeparator", false, "div");
        } else {
            if (document.all) {
                oDoc.innerHTML = oDoc.innerText;
            } else {
                oContent = document.createRange();
                oContent.selectNodeContents(oDoc.firstChild);
                oDoc.innerHTML = oContent.toString();
            }
            oDoc.contentEditable = true;
        }
        oDoc.focus();
        */
}

function printDoc() {
    if (!validateMode()) { return; }
    var oPrntWin = window.open("", "_blank", "width=450,height=470,left=400,top=100,menubar=yes,toolbar=no,location=no,scrollbars=yes");
    oPrntWin.document.open();
    oPrntWin.document.write("<!doctype html><html><head><title>Print<\/title><\/head><body onload=\"print();\">" + oDoc.innerHTML + "<\/body><\/html>");
    oPrntWin.document.close(); /*  */
}
