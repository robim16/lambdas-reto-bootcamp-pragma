import { SQSClient, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const sqs = new SQSClient({ region: process.env.AWS_REGION });
const ses = new SESClient({ region: process.env.AWS_REGION });

export const handler = async (event) => {
  console.log("Lambda iniciada");
  console.log("Evento recibido de SQS:", JSON.stringify(event, null, 2));

  if (!event.Records || event.Records.length === 0) {
    console.log("No se recibieron mensajes en el evento");
    return { statusCode: 200, body: JSON.stringify({ message: "Evento vacío" }) };
  }

  for (const record of event.Records) {
    console.log("Mensaje recibido:", record.body);

    let notification;
    try {
      notification = JSON.parse(record.body); // Parsear JSON de SQS
    } catch (err) {
      console.error("Error parseando mensaje SQS:", err, "Body:", record.body);
      continue; // Saltar mensaje inválido
    }

    const { type, payload, destino } = notification;

    // Construir contenido del correo
    const messageBody = `Tipo de notificación: ${type}\nDestino: ${destino}\nContenido:\n${JSON.stringify(payload, null, 2)}`;

    const emailParams = {
      Source: process.env.SENDER_EMAIL,
      Destination: { ToAddresses: [process.env.RECIPIENT_EMAIL] },
      Message: {
        Subject: { Data: `Notificación: ${type}` },
        Body: { Text: { Data: messageBody } }
      }
    };

    try {
      console.log("Enviando correo a:", process.env.RECIPIENT_EMAIL);
      const result = await ses.send(new SendEmailCommand(emailParams));
      console.log("SES result:", JSON.stringify(result, null, 2));

      // Opcional: eliminar mensaje de la cola si se procesó correctamente
      if (record.receiptHandle) {
        await sqs.send(new DeleteMessageCommand({
          QueueUrl: process.env.SQS_QUEUE_URL,
          ReceiptHandle: record.receiptHandle
        }));
        console.log("Mensaje eliminado de SQS:", record.messageId);
      }

    } catch (err) {
      console.error("Error enviando correo o eliminando mensaje:", err);
      continue; // seguir con el siguiente mensaje
    }
  }

  return { statusCode: 200, body: JSON.stringify({ message: "Procesado correctamente" }) };
};
