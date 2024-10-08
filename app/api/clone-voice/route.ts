import { NextResponse } from 'next/server'
import { Client } from '@gradio/client'

export async function POST(request: Request) {
  const formData = await request.formData()
  const text = formData.get('text') as string
  const audioFile = formData.get('audio_file') as File

  console.log('Received request:', { text, audioFile: audioFile?.name })

  try {
    const client = await Client.connect("nikkmitra/clone")
    console.log('Connected to Gradio client')

    const result = await client.predict("/clone_voice", {
      text,
      audio_file: audioFile,
      language: "en",
    })

    console.log('Gradio prediction result:', result)

    if (result && result.data && result.data[0] && result.data[0].url) {
      const audioUrl = result.data[0].url
      
      // Download the audio file
      const audioResponse = await fetch(audioUrl)
      if (!audioResponse.ok) {
        throw new Error(`Failed to download audio: ${audioResponse.statusText}`)
      }
      const audioBlob = await audioResponse.blob()

      // Convert blob to base64
      const buffer = Buffer.from(await audioBlob.arrayBuffer())
      const base64Audio = buffer.toString('base64')

      return NextResponse.json({ audioData: `data:audio/wav;base64,${base64Audio}` })
    } else {
      throw new Error("Failed to clone voice: No data in result")
    }
  } catch (error) {
    console.error("Error in Clone Voice API:", error)
    return NextResponse.json({ error: "Failed to clone voice: " + (error as Error).message }, { status: 500 })
  }
}