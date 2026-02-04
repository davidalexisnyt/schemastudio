package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"schemastudio/internal/app"
)

var Version string = "0.3.1"

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	a := app.NewApp(Version)
	err := wails.Run(&options.App{
		Title:  "Schema Studio",
		Width:  1280,
		Height: 800,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 0x1e, G: 0x1e, B: 0x2e, A: 0xff},
		OnStartup:        a.Startup,
		Bind: []interface{}{
			a,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
