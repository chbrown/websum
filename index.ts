import {Readable, Writable} from 'stream'
import {Parser, Handler} from 'htmlparser2'

export const tagScores = {
  title: 100000,
  h1: 50000,
  h2: 10000,
  h3: 5000,
  h4: 1000,
  h5: 500,
  h6: 100,
  main: 1000,
  section: 500,
  article: 500,
  p: 100,
  ul: 100,
  ol: 200,
  script: -100000,
  style: -100000,
}

export const metaScores = {
  description: 10000,
  keywords: 5000,
  author: 1000,
}

export interface Snippet {
  score: number
  content: string
}

/** From the docs: https://github.com/fb55/htmlparser2/wiki/Parser-options

    onopentag(<str> name, <obj> attributes)
    onopentagname(<str> name)
    onattribute(<str> name, <str> value)
    ontext(<str> text)
    onclosetag(<str> name)
    onprocessinginstruction(<str> name, <str> data)
    oncomment(<str> data)
    oncommentend()
    oncdatastart()
    oncdataend()
    onerror(<err> error)
    onreset()
    onend()
*/
export class SummarizingHandler implements Handler {
  snippets: Snippet[] = []
  // current score / position
  private score = 1
  private position = -50
  constructor(public callback: (error: Error, snippets?: Snippet[]) => void) { }
  onreset() {
    this.score = 1
    this.position = -50
    this.snippets = []
  }
  onend() {
    this.callback(null, this.snippets)
  }
  onerror(error: Error) {
    this.callback(error)
  }
  onopentag(name: string, attribs: {[index: string]: string}) {
    this.score += tagScores[name] || 0

    if (name == 'meta' && attribs.name && attribs.content) {
      this.snippets.push({
        score: metaScores[attribs.name.toLowerCase()],
        content: attribs.content,
      })
    }
  }
  onclosetag(name) {
    this.score -= tagScores[name] || 0
  }
  ontext(data) {
    let content = data
    if (this.snippets.length && this.snippets[this.snippets.length - 1].score == this.score) {
      // merge if possible
      const last_span = this.snippets.pop()
      content = last_span.content + content
    }
    this.position++

    const score = this.score - this.position
    this.snippets.push({score, content})
  }
}

export function joinSnippets(snippets: Snippet[], minimumScore: number): string {
  return snippets
    // remove empty snippets
    .filter(({content}) => content.trim().length > 1)
    // remove snippets below score threshold
    .filter(({score}) => score >= minimumScore)
    // sort descending by score
    .sort((span_a, span_b) => span_b.score - span_a.score)
    // clean up whitespace
    .map(({content}) => content.replace(/\s+/g, ' ').trim())
    // join into single string
    .join('; ')
}

export function summarizeHtml(inputHtml: string,
                              minimumScore: number,
                              callback: (error: Error, result?: string) => void) {
  const handler = new SummarizingHandler((error, snippets) => {
    if (error) return callback(error)
    const result = joinSnippets(snippets, minimumScore)
    callback(null, result)
  })

  const parser = new Parser(handler, {decodeEntities: true})
  parser.write(inputHtml)
  parser.end()
}

function readToEnd(stream: Readable,
                   callback: (error: Error, chunks?: any[]) => void) {
  const chunks: Array<Buffer | string> = []
  return stream
  .on('error', callback)
  .on('data', chunk => chunks.push(chunk))
  .on('end', () => callback(null, chunks))
}

function convert(inputStream: Readable,
                 outputStream: Writable,
                 callback: (error: Error) => void) {
  readToEnd(inputStream, (error, chunks) => {
    if (error) return callback(error)

    const inputHtml = chunks.map(chunk => chunk.toString()).join(' ')
    summarizeHtml(inputHtml, 25, (error, result) => {
      if (error) return callback(error)

      outputStream.write(result, callback)
    })
  })
}

export function main() {
  convert(process.stdin, process.stdout, error => {
    if (error) {
      console.error(error.toString())
      process.exit(1)
    }
    process.exit(0)
  })
}
