function savehtml() {
    var htm = document.body.appendChild(
        document.createElement("htm")
    );
    htm.download = "demo.txt";
    htm.href = "data:text/plain," + document.getElementById("fileDisplayArea").innerHTML;
    htm.click();
}