

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const ses = new SESClient({ region: process.env.AWS_REGION });


const sqs = new SQSClient({ region: process.env.AWS_REGION });
const queueUrl = "https://sqs.us-east-1.amazonaws.com/276824024432/resultado-lambda-endeudamiento";

export const handler = async (event) => {
  console.log("Mensajes recibidos:", event.Records.length);

  for (const record of event.Records) {
    try {
      const notificacion = JSON.parse(record.body);
      console.log("Notificación:", notificacion.type);
      let estadoPrestamo = "";

      // Verificar si payload ya es objeto o string
      const payload =
        typeof notificacion.payload === "string"
          ? JSON.parse(notificacion.payload)
          : notificacion.payload;

      const { prestamos, solicitud } = payload;

      if (!Array.isArray(prestamos)) {
        console.error("El payload no contiene un array de préstamos");
        continue;
      }

      // Procesar préstamos
      for (const prestamo of prestamos) {
        const tasaMensual = prestamo.tasaInteres / 12;
        const plazo = parseInt(prestamo.plazo, 10);
        const monto = prestamo.monto;

        const cuotaMensual =
          (monto * tasaMensual) /
          (1 - Math.pow(1 + tasaMensual, -plazo));

        prestamo.cuotaMensual = cuotaMensual;
      }

      const deudaMensualActual = prestamos.reduce(
        (acc, p) => acc + p.cuotaMensual,
        0
      );

      const salarioBase = prestamos[0]?.salarioBase || 0;
      const capacidadEndeudamientoMaxima = salarioBase * 0.35;
      const capacidadDisponible =
        capacidadEndeudamientoMaxima - deudaMensualActual;

      console.log("Préstamos procesados:", prestamos.length);
      prestamos.forEach((p) => {
        console.log(`Prestamo ID: ${p.id}`);
        console.log(` -> Cuota Mensual: ${p.cuotaMensual}`);
      });

      //calcular cuota mensual de la nueva solicitud
      const tasaMensualNuevaSol = solicitud.tasaInteres / 12;
      const plazoNuevaSol = parseInt(solicitud.plazo, 10);
      const montoNuevaSol = solicitud.monto;

      const cuotaMensualNuevaSol =
        (montoNuevaSol * tasaMensualNuevaSol) /
        (1 - Math.pow(1 + tasaMensualNuevaSol, -plazoNuevaSol));


      if (cuotaMensualNuevaSol <= capacidadDisponible) {
        if (montoNuevaSol > (5*salarioBase)) {
          estadoPrestamo = "Revisión manual";
        } else {
          estadoPrestamo = "Aprobado";
        }
      } else {
        estadoPrestamo = "Rechazado";
      }

      console.log("Estado del préstamo:", estadoPrestamo)

      //generar cuotas
      if (estadoPrestamo === "Aprobado") {
        const cuotas = [];
        let saldoPendiente = montoNuevaSol;
    
        for (let i = 0; i < plazoNuevaSol; i++) {
            const interes = saldoPendiente * tasaMensualNuevaSol;
            const abonoCapital = cuotaMensualNuevaSol - interes;
            saldoPendiente -= abonoCapital;
    
            cuotas.push({
                numeroCuota: i + 1,
                monto: cuotaMensualNuevaSol,
                abonoCapital: abonoCapital,
                interes: interes,
                saldoPendiente: saldoPendiente > 0 ? saldoPendiente : 0,
                estado: "Pendiente",
            });
        }
    
        // Generar tabla HTML para el email
        let htmlCuotas = `
          <h2>Detalle de cuotas de su préstamo aprobado</h2>
          <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">
            <thead>
              <tr>
                <th>Cuota</th>
                <th>Monto Total</th>
                <th>Abono a Capital</th>
                <th>Intereses</th>
                <th>Saldo Pendiente</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
        `;
    
        cuotas.forEach(cuota => {
            htmlCuotas += `
              <tr>
                <td>${cuota.numeroCuota}</td>
                <td>${cuota.monto.toFixed(2)}</td>
                <td>${cuota.abonoCapital.toFixed(2)}</td>
                <td>${cuota.interes.toFixed(2)}</td>
                <td>${cuota.saldoPendiente.toFixed(2)}</td>
                <td>${cuota.estado}</td>
              </tr>
            `;
        });
    
        htmlCuotas += `</tbody></table>`;
    
        // Parámetros del email con HTML
        const emailParams = {
            Source: process.env.SENDER_EMAIL,
            Destination: { ToAddresses: [process.env.RECIPIENT_EMAIL] },
            Message: {
                Subject: { Data: `Cuotas de su préstamo aprobado` },
                Body: {
                    Html: { Data: htmlCuotas }
                }
            }
        };
    
        try {
          console.log("Enviando correo a:", process.env.RECIPIENT_EMAIL);
          const result = await ses.send(new SendEmailCommand(emailParams));
          console.log("SES result:", JSON.stringify(result, null, 2));
        } catch (err) {
          console.error("Error enviando correo:", err);
        }
      }

      let idNuevoEstadoSolicitud = 0;

      if (estadoPrestamo === "Aprobado") {
        idNuevoEstadoSolicitud = 3;
      } else if (estadoPrestamo === "Rechazado") {
        idNuevoEstadoSolicitud = 2;
      } else if (estadoPrestamo === "Revisión manual") {
        idNuevoEstadoSolicitud = 4;
      } 

      const mensaje = {
        idSolicitud: solicitud.id,
        estado: idNuevoEstadoSolicitud,
      };

      try {
        const command = new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(mensaje),
        });
  
        const response = await sqs.send(command);
        console.log("Mensaje enviado a resultado-lambda-endeudamiento:", response.MessageId);
        
      } catch (error) {
        console.error("Error enviando mensaje a la cola:", error);
      }

     
        
      console.log("Deuda Mensual Actual:", deudaMensualActual);
      console.log(
        "Capacidad Endeudamiento Máxima:",
        capacidadEndeudamientoMaxima
      );
      console.log("Capacidad Disponible:", capacidadDisponible);

      if (solicitud) {
        console.log("Nueva Solicitud:", solicitud);
      }

    } catch (err) {
      console.error("Error procesando mensaje:", err);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Procesado correctamente" }),
  };
};
