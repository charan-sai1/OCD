// Command ocd is the OCD Manager: verified phone import, content dedupe with
// quarantine, and a thin manager for the Photofield browsing engine.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"ocd/internal/dedupe"
	"ocd/internal/importer"
	"ocd/internal/server"
)

func usage() {
	fmt.Fprint(os.Stderr, `OCD Manager

Usage:
  ocd serve    [--port 8090] [--data DIR] [--photofield EXE] [--photofield-data DIR]
  ocd dedupe scan       --dir DIR [--dir DIR2] [--min-size BYTES] [--json OUT]
  ocd dedupe quarantine --report FILE --quarantine DIR [--dry-run] [--keep first|shortest|oldest]
  ocd import --source DIR|SERIAL|/PATH --dest DIR [--adb] [--dry-run] [--delete]
             [--dup-check content|name] [--dup-action skip|copy]
             (copy+verify is the default; --delete wipes verified originals from the phone)

Serve runs the web UI (Import / Duplicates / Browse / Setup).
`)
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "serve":
		serve(os.Args[2:])
	case "dedupe":
		if len(os.Args) < 3 {
			usage()
			os.Exit(2)
		}
		switch os.Args[2] {
		case "scan":
			dedupeScan(os.Args[3:])
		case "quarantine":
			dedupeQuarantine(os.Args[3:])
		default:
			usage()
			os.Exit(2)
		}
	case "import":
		importCmd(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
}

type multiFlag []string

func (m *multiFlag) String() string { return fmt.Sprint(*m) }
func (m *multiFlag) Set(v string) error {
	*m = append(*m, v)
	return nil
}

func serve(args []string) {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	port := fs.Int("port", 8090, "HTTP port")
	data := fs.String("data", defaultDataDir(), "data directory (indexes, quarantine)")
	pf := fs.String("photofield", "", "path to photofield executable")
	pfd := fs.String("photofield-data", "", "photofield data dir")
	_ = fs.Parse(args)

	s := server.New(server.Config{DataDir: *data, PhotofieldExe: *pf, PhotofieldData: *pfd, AutoScan: true})
	addr := fmt.Sprintf(":%d", *port)
	log.Printf("OCD Manager on http://localhost%s", addr)
	s.StartBackgroundIndex()
	log.Fatal(http.ListenAndServe(addr, s.Handler()))
}

func dedupeScan(args []string) {
	fs := flag.NewFlagSet("dedupe scan", flag.ExitOnError)
	var dirs multiFlag
	fs.Var(&dirs, "dir", "directory to scan (repeatable)")
	minSize := fs.Int64("min-size", 1, "minimum file size (bytes)")
	out := fs.String("json", "", "write full result JSON here")
	_ = fs.Parse(args)
	if len(dirs) == 0 {
		log.Fatal("at least one --dir is required")
	}

	res, err := dedupe.FindDuplicates(dedupe.Options{
		Dirs:    dirs,
		MinSize: *minSize,
		Progress: func(p dedupe.Progress) {
			fmt.Fprintf(os.Stderr, "\r%s %d %s", p.Phase, p.Done, p.Message)
		},
	}, nil)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Fprintln(os.Stderr)
	printDedupeSummary(res)
	if *out != "" {
		b, _ := json.MarshalIndent(res, "", "  ")
		if err := os.WriteFile(*out, b, 0o644); err != nil {
			log.Fatal(err)
		}
		fmt.Println("wrote", *out)
	}
}

func printDedupeSummary(res dedupe.Result) {
	fmt.Printf("files scanned:      %d\n", res.TotalFiles)
	fmt.Printf("duplicate groups:   %d\n", len(res.Groups))
	fmt.Printf("duplicate files:    %d\n", res.DuplicateFiles)
	fmt.Printf("redundant copies:   %d\n", res.RedundantCopies)
	fmt.Printf("reclaimable:        %.2f GB\n", float64(res.ReclaimableBytes)/(1024*1024*1024))
}

func dedupeQuarantine(args []string) {
	fs := flag.NewFlagSet("dedupe quarantine", flag.ExitOnError)
	report := fs.String("report", "", "JSON report from `dedupe scan --json`")
	quar := fs.String("quarantine", "", "quarantine directory")
	dry := fs.Bool("dry-run", false, "report only, move nothing")
	keep := fs.String("keep", "first", "keeper strategy: first|shortest|oldest")
	_ = fs.Parse(args)
	if *report == "" || *quar == "" {
		log.Fatal("--report and --quarantine are required")
	}
	b, err := os.ReadFile(*report)
	if err != nil {
		log.Fatal(err)
	}
	var res dedupe.Result
	if err := json.Unmarshal(b, &res); err != nil {
		log.Fatal(err)
	}
	qr, err := dedupe.Quarantine(res.Groups, dedupe.QuarantineOptions{
		QuarantineDir: *quar,
		DryRun:        *dry,
		Keep:          *keep,
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("moved: %d files, freed %.2f GB (dry-run=%v)\n", len(qr.Moved), float64(qr.Freed)/(1024*1024*1024), *dry)
	for _, e := range qr.Errors {
		fmt.Println("error:", e)
	}
}

func importCmd(args []string) {
	fs := flag.NewFlagSet("import", flag.ExitOnError)
	source := fs.String("source", "", "source folder, adb serial|/sdcard/DCIM, or path")
	dest := fs.String("dest", "", "destination folder (e.g. E:/Photos)")
	adb := fs.Bool("adb", false, "source is an Android device over adb")
	dry := fs.Bool("dry-run", false, "report only, copy nothing")
	del := fs.Bool("delete", false, "delete verified files from the phone")
	data := fs.String("data", defaultDataDir(), "data directory for the content-hash index")
	dupCheck := fs.String("dup-check", "content", "how duplicates are detected: content | name")
	dupAction := fs.String("dup-action", "skip", "what to do with a duplicate: skip | copy")
	_ = fs.Parse(args)
	if *source == "" || *dest == "" {
		log.Fatal("--source and --dest are required")
	}

	var src importer.Source
	if *adb {
		src = &importer.AdbSource{Root: *source}
	} else {
		src = &importer.LocalSource{Root: *source}
	}

	// Duplicate index for the destination — lets the importer skip media that
	// is already there, so nothing is ever stored twice.
	var idx *importer.Index
	if *dupAction == "skip" {
		idxPath := filepath.Join(*data, *dupCheck+"index-"+sanitizeName(*dest)+".json")
		build := func(n int, msg string) {
			fmt.Fprintf(os.Stderr, "\rindexing existing files: %d %s", n, msg)
		}
		var err error
		if *dupCheck == "name" {
			idx, err = importer.LoadOrBuildNameIndex(idxPath, []string{*dest}, build)
		} else {
			idx, err = importer.LoadOrBuildIndex(idxPath, []string{*dest}, build)
		}
		if err != nil {
			log.Printf("warning: could not build index (%v); duplicates may not be skipped", err)
			idx = nil
		} else if idx.Len() > 0 {
			fmt.Fprintf(os.Stderr, "\rindexed %d existing file(s) on the drive\n", idx.Len())
		}
	}

	res, err := importer.Import(src, importer.Options{
		DestRoot:          *dest,
		DryRun:            *dry,
		DeleteAfterVerify: *del,
		DupCheck:          *dupCheck,
		DupAction:         *dupAction,
		Index:             idx,
		Progress: func(p importer.Progress) {
			fmt.Fprintf(os.Stderr, "\r%s %d/%d %s", p.Phase, p.Done, p.Total, p.Message)
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	if !*dry && idx != nil {
		_ = idx.Save()
	}
	fmt.Fprintln(os.Stderr)
	fmt.Printf("imported: %d  skipped: %d  deleted: %d  (%.2f GB)  [dup: %s/%s]\n",
		len(res.Imported), len(res.Skipped), len(res.Deleted),
		float64(res.Bytes)/(1024*1024*1024), *dupCheck, *dupAction)
	for _, e := range res.Errors {
		fmt.Println("error:", e)
	}
}

// sanitizeName turns a path into a safe filename component for the index file.
func sanitizeName(p string) string {
	r := strings.NewReplacer(":", "", "\\", "_", "/", "_", " ", "_")
	return strings.Trim(r.Replace(p), "_")
}

func defaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "ocd-data"
	}
	return filepath.Join(home, "ocd-app", "engine-data")
}
